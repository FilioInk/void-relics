import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { AudioEngine } from '../audio/engine.ts';
import { InfiniteFlight } from '../infinite/flight.ts';
import { createInstallOffer } from '../ui/install.ts';
import { t, type Key } from '../text.ts';
import { createArtifacts, type ArtifactView } from '../render/artifacts.ts';
import { createAsteroids, type AsteroidView } from '../render/asteroids.ts';
import { createCombatFx, type CombatFx, type LootItem } from '../render/combat.ts';
import { createDebris, type DebrisView } from '../render/debris.ts';
import { createGpuTimer, type GpuTimer } from '../render/gpuTimer.ts';
import { createGigastructure, createMegastructure, type GigaView, type MegaView } from '../render/megastructures.ts';
import { createDust, type DustView } from '../render/dust.ts';
import { createNebulae, type NebulaView } from '../render/nebula.ts';
import { createPlanet, type PlanetView } from '../render/planets.ts';
import { BloomOutputPass, BloomPass } from '../render/post.ts';
import { GUN_MOUNTS, SHIP_RADIUS, createShip, type ShipView } from '../render/ship.ts';
import { createSky, type Sky } from '../render/sky.ts';
import { createSun, type SunView } from '../render/sun.ts';
import { createWrecks, type WreckView } from '../render/wrecks.ts';
import { createHud, type Hud, type Marker, type Warning } from '../ui/hud.ts';
import { createMap, type MapView } from '../ui/map.ts';
import { createPerfOverlay, type PerfOverlay } from '../ui/perf.ts';
import { PerfStats } from '../ui/perfStats.ts';
import { createScreens } from '../ui/screens.ts';
import { createTouchControls, type TouchControls } from '../ui/touchControls.ts';
import { generateAsteroids, generateJunk, generateWorld, type Asteroid, type World } from '../world/generate.ts';
import { gigaBands, megaColliders, type Band, type StructureChances } from '../world/megastructures.ts';
import { nebulaDensityAt, regionAt, scanRange, type Region } from '../world/regions.ts';
import { aimOf, moveCursor, steerRadius, type Cursor } from './aim.ts';
import { BENCH_SPOTS, benchSpot, type BenchSpotName } from './benchSpots.ts';
import { stepExposure, targetExposure } from './exposure.ts';
import { approach, createFlightState, forwardOf, stepFlight, type FlightInput, type FlightState } from './flight.ts';
import { collideBand, collideDisc, collideSphere, createHull, damageHull, impactDamage, repairHull, sunHeat, tickHull, type Hull } from './hazards.ts';
import { PICKUP_RADIUS, collect, formatTime, isComplete, markBroken, parseProgress, storageKey, type Progress } from './progress.ts';
import { SETTINGS_KEY, writeStore, readStore, type Settings } from './settings.ts';
import { SpatialHash } from './spatialHash.ts';
import { SEALED_CONTEXTS, SHELL_RADIUS, lootOf, segmentBand, segmentDisc, segmentSphere, stepBolts, targetHp, targetId, type Bolt, type BoltHit, type Target } from './targets.ts';
import { cursorOf, isTouchFirst } from './touch.ts';
import { WEAPON, createWeapon, stepWeapon } from './weapons.ts';

type State = 'loading' | 'menu' | 'playing' | 'paused' | 'map' | 'dead' | 'victory' | 'infinite';

const REGION_KEYS: Record<Region['kind'], Key> = {
  star: 'regionStar',
  wreck: 'regionWreck',
  station: 'regionStation',
  graveyard: 'regionGraveyard',
  gate: 'regionGate',
  habitat: 'regionHabitat',
  lattice: 'regionLattice',
  ringworld: 'regionRingworld',
  junk: 'regionJunk',
  nebula: 'regionNebula',
  field: 'regionField',
  belt: 'regionBelt',
  planet: 'regionPlanet',
  deep: 'regionDeep',
};

const CAMERA_OFFSET = new THREE.Vector3(0, 7.5, 34);

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: BloomPass;
  private readonly renderPass: RenderPass;
  private infinite: InfiniteFlight | null = null;
  /** `?mega=` / `?giga=`: the shares of places with a mega- or gigastructure, or the defaults. */
  private readonly chances: StructureChances;
  private readonly scene = new THREE.Scene();
  // Fog lives on the scene for the whole session and is only thinned to zero outside nebulae:
  // swapping it for null at a nebula edge made every material pick a new shader (a hitch).
  private readonly fog = new THREE.FogExp2(0x000000, 0);
  private readonly camera = new THREE.PerspectiveCamera(70, 1, 0.5, 2_000_000);
  private readonly clock = new THREE.Timer();
  private readonly ui: HTMLElement;
  private fill!: THREE.DirectionalLight;

  private world!: World;
  private grid!: SpatialHash<Target>;
  private sky!: Sky;
  private sun!: SunView;
  private planets: PlanetView[] = [];
  private nebulae!: NebulaView;
  private wrecks!: WreckView;
  private debris!: DebrisView;
  /** The system's megastructures and its gigastructure, if it has them. */
  private structures: MegaView[] = [];
  private giga: GigaView | null = null;
  /** The gigastructure's solid bands: too big for the collision grid, so checked on their own. */
  private bands: Band[] = [];
  private asteroids!: AsteroidView;
  private rocks: Asteroid[] = [];
  private fx!: CombatFx;
  private artifacts!: ArtifactView;
  private ship!: ShipView;
  private dust!: DustView;
  private hud!: Hud;
  private map!: MapView;
  /** On-screen stick and buttons; on screen only on a touch-first device (`touchMode`). */
  private touch!: TouchControls;
  private touchMode = false;
  private readonly screens: ReturnType<typeof createScreens>;

  private flight!: FlightState;
  private hull: Hull = createHull();
  private progress!: Progress;
  private audio: AudioEngine | null = null;

  // Lasers.
  private readonly weapon = createWeapon();
  private readonly bolts: Bolt[] = [];
  private firing = false;
  private wasOverheated = false;
  /** Hits taken so far by targets that have not broken yet. */
  private readonly damage = new Map<Target, number>();
  /** Relics still sealed inside a shell of rock. */
  private readonly sealed = new Set<string>();
  private readonly loot: LootItem[] = [];
  private readonly hitScratch: Target[] = [];

  private state: State = 'loading';
  private readonly keys = new Set<string>();
  private cursor: Cursor = { x: 0, y: 0 };
  private locked = false;
  private readonly camQuat = new THREE.Quaternion();
  private bank = 0;
  private shake = 0;
  private deadTimer = 0;
  private saveTimer = 0;
  private regionTimer = 0;
  private regionId = '';
  private readonly inScan = new Set<string>();
  // Per-frame scratch, reused so a frame allocates nothing the garbage collector must chase.
  private readonly input: FlightInput = { aimX: 0, aimY: 0, thrust: false, brake: false, boost: false, strafe: 0, roll: 0 };
  private readonly near: Target[] = [];
  private readonly markers: Marker[] = [];
  private readonly markerPool: Marker[] = [];
  private readonly nebulaCss = new Map<string, string>();
  private time = 0;
  private menuAngle = 0;
  private victoryShown = false;

  private readonly seed: number;
  private settings: Settings;
  private readonly debug: boolean;

  // ?perf=1: frame timing and renderer counters.
  private readonly perf: PerfStats | null;
  private perfOverlay: PerfOverlay | null = null;
  private gpuTimer: GpuTimer | null = null;
  private readonly gpuSamples: number[] = [];
  private lastFrameAt = NaN;
  // ?debug=1: a pinned clock for reproducible screenshots, and a pending canvas capture.
  private stillTime: number | null = null;
  private captureNext: ((dataUrl: string) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement, seed: number, settings: Settings, debug: boolean, perf = false, chances: StructureChances = {}) {
    this.ui = ui;
    this.chances = chances;
    this.seed = seed;
    this.settings = settings;
    this.debug = debug;
    this.perf = perf ? new PerfStats() : null;
    // Depth for a scene from 0.5 m to 400 km: reversed Z into a float depth buffer where the
    // browser has EXT_clip_control (no fragment-shader depth writes, so early-Z works), and
    // the logarithmic depth buffer elsewhere.
    const reversed = supportsReversedDepth();
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // The scene is drawn into the composer's single-sample target and the canvas only ever
      // receives one full-screen quad: multisampling it bought nothing but a resolve per frame.
      antialias: false,
      reversedDepthBuffer: reversed,
      logarithmicDepthBuffer: !reversed,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Reversed Z only pays off with a float depth buffer, so the scene target gets one.
    const sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType) });
    this.composer = new EffectComposer(this.renderer, sceneTarget);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new BloomPass(new THREE.Vector2(1, 1), 0.8, 0.55, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new BloomOutputPass(this.bloom));

    if (this.perf) {
      // The composer renders several passes per frame; count all of them, not just the last.
      this.renderer.info.autoReset = false;
      this.gpuTimer = createGpuTimer(this.renderer.getContext() as WebGL2RenderingContext);
      this.perf.gpuSupported = this.gpuTimer.supported;
      this.perfOverlay = createPerfOverlay();
      this.ui.append(this.perfOverlay.el);
    }

    // Touch-first devices get on-screen controls. A tablet that gains a trackpad switches back.
    const touchQuery = window.matchMedia('(pointer: coarse)');
    this.setTouchMode(isTouchFirst((q) => window.matchMedia(q).matches));
    touchQuery.addEventListener('change', () => {
      this.setTouchMode(isTouchFirst((q) => window.matchMedia(q).matches));
      this.screens.refresh();
    });

    // "Install app" in the menu; it leaves the menu once the browser says the app is installed.
    const install = createInstallOffer();
    install.subscribe(() => this.screens.refresh());

    this.screens = createScreens(
      {
        onInstall: () => install.install(),
        onLaunch: () => this.launch(),
        onNewGalaxy: () => this.newGalaxy(),
        onInfinite: () => this.startInfinite(),
        onResume: () => this.resume(),
        onMenu: () => this.toMenu(),
        onKeepFlying: () => this.resume(),
        onSettings: (next) => this.applySettings(next),
      },
      () => ({
        seed: this.seed,
        found: this.progress?.found.length ?? 0,
        settings: this.settings,
        victoryTime: formatTime(this.progress?.finishedAt ?? this.progress?.elapsed ?? 0),
        touch: this.touchMode,
        installable: install.visible(),
      }),
    );
    this.ui.append(this.screens.el);
    this.screens.show('loading');
    this.screens.refresh();
  }

  /** Builds the whole system. Split across frames so the loading text gets painted first. */
  async build(): Promise<void> {
    await nextFrame();
    const world = generateWorld(this.seed, this.chances);
    this.world = world;
    const rocks = generateAsteroids(world);

    this.sky = createSky(this.renderer, this.seed);
    this.scene.background = this.sky.background;
    this.scene.fog = this.fog;
    // Shared with the infinite flight's scene: never disposed with a chunk.
    this.sky.background.userData['shared'] = true;
    this.scene.add(this.sky.stars);

    this.sun = createSun(world.sun);
    this.scene.add(this.sun.group);
    this.scene.add(new THREE.AmbientLight(0x8090b0, 0.12));
    this.scene.add(new THREE.HemisphereLight(0x324058, 0x0a0806, 0.25));
    // A soft fill from behind the camera keeps the ship and nearby rocks readable on their night side.
    this.fill = new THREE.DirectionalLight(0x9fb4d8, 0.55);
    this.scene.add(this.fill, this.fill.target);

    const sunPos = new THREE.Vector3(...world.sun.position);
    for (const p of world.planets) {
      const view = createPlanet(p, sunPos);
      this.planets.push(view);
      this.scene.add(view.group);
    }
    await nextFrame();

    this.rocks = rocks;
    this.asteroids = createAsteroids(rocks, this.seed);
    this.scene.add(this.asteroids.group);
    this.wrecks = createWrecks(world.wrecks);
    this.scene.add(this.wrecks.group);
    this.debris = createDebris(world.stations, world.graveyards, generateJunk(world), this.sky.background, this.seed);
    this.scene.add(this.debris.group);
    for (const m of world.megastructures) {
      const view = createMegastructure(m.shape, this.sky.background);
      view.group.position.set(...m.shape.center);
      this.scene.add(view.group);
      this.structures.push(view);
    }
    if (world.giga) {
      this.giga = createGigastructure(world.giga.shape, this.sky.background);
      this.giga.group.position.set(...world.giga.shape.center);
      this.scene.add(this.giga.group);
      this.bands = gigaBands(world.giga.shape);
    }
    await nextFrame();

    this.nebulae = createNebulae(world.nebulae, this.seed);
    this.scene.add(this.nebulae.group);

    this.artifacts = createArtifacts(world.artifacts);
    this.scene.add(this.artifacts.group);

    this.ship = createShip(this.sky.background);
    this.scene.add(this.ship.root);
    this.dust = createDust();
    this.scene.add(this.dust.lines);
    this.fx = createCombatFx();
    this.scene.add(this.fx.group);

    const ids = new Set(world.artifacts.map((a) => a.id));
    this.progress = parseProgress(readStore(storageKey(this.seed)), this.seed, ids);
    this.artifacts.setFound(this.progress.found);

    // Everything solid. What was shot apart in an earlier session stays gone.
    const broken = new Set(this.progress.broken);
    const colliders: Target[] = rocks.map((r, i) => ({ position: r.position, radius: r.radius * 0.92, kind: 'rock', ref: i }));
    colliders.push(...this.wrecks.colliders, ...this.debris.colliders);
    for (const m of world.megastructures) colliders.push(...megaColliders(m.shape));
    world.artifacts.forEach((a, i) => {
      if (!SEALED_CONTEXTS.has(a.context) || this.progress.found.includes(a.id) || broken.has(targetId('shell', i))) return;
      this.sealed.add(a.id);
      colliders.push({ position: a.position, radius: SHELL_RADIUS, kind: 'shell', ref: i });
      this.fx.addShell(i, new THREE.Vector3(...a.position), SHELL_RADIUS, a.hue);
    });
    const live = colliders.filter((c) => {
      if (!c.kind || c.ref === undefined || !broken.has(targetId(c.kind, c.ref))) return true;
      if (c.kind === 'rock') this.asteroids.hide(c.ref);
      else if (c.kind === 'satellite' || c.kind === 'junk') this.debris.hide(c.kind, c.ref);
      return false;
    });
    this.grid = new SpatialHash(600, live);
    this.victoryShown = isComplete(this.progress);

    this.hud = createHud();
    this.map = createMap(world, rocks);
    this.ui.prepend(this.hud.el, this.map.el);
    this.touch = createTouchControls({ onMap: () => this.toggleMap(), onPause: () => this.pause() });
    this.ui.append(this.touch.el);
    this.hud.setRelics(this.progress.found.length);
    this.hud.setSalvage(this.progress.salvage);
    this.hud.setSeedLine(t('galaxy', { seed: this.seed }));

    this.respawn();
    this.bindInput();
    this.onResize();
    window.addEventListener('resize', () => this.onResize());

    // Compile shaders before the first visible frame to avoid a hitch on launch.
    this.renderer.compile(this.scene, this.camera);
    this.state = 'menu';
    this.screens.show('menu');
    if (this.debug) this.exposeDebug();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // --- lifecycle -------------------------------------------------------------------------

  private respawn(): void {
    const spawn = new THREE.Vector3(...this.world.spawn.position);
    this.flight = createFlightState(spawn, new THREE.Vector3(...this.world.spawn.lookAt));
    this.camQuat.copy(this.flight.orientation);
    repairHull(this.hull);
    this.ship.root.visible = true;
    this.cursor = { x: 0, y: 0 };
  }

  /** Audio may only start from a click, so it is created on the first one that needs it. */
  private ensureAudio(): void {
    if (!this.audio) {
      try {
        this.audio = new AudioEngine(this.seed);
        this.audio.setMusic(this.settings.music);
        this.audio.setMusicVolume(this.settings.musicVolume);
        this.audio.setSound(this.settings.sound);
        this.audio.start();
      } catch {
        this.audio = null;
      }
    }
    void this.audio?.resume();
  }

  private async launch(): Promise<void> {
    this.ensureAudio();
    this.audio?.click();
    this.state = 'playing';
    this.screens.show('none');
    this.hud.show(true);
    this.regionId = '';
    if (!this.touchMode) this.requestLock();
  }

  /** Infinite flight: its own scene, drawn instead of the system until Esc. */
  private startInfinite(): void {
    this.ensureAudio();
    this.audio?.click();
    this.screens.show('none');
    this.hud.show(false);
    this.map.el.hidden = true;
    if (document.pointerLockElement) document.exitPointerLock();
    this.infinite = new InfiniteFlight({
      renderer: this.renderer,
      camera: this.camera,
      envMap: this.sky.background,
      stars: this.sky.stars,
      seed: this.seed,
      sounds: () => this.audio,
      onBack: () => this.exitInfinite(),
      music: this.settings.music,
      onMusic: () => this.toggleMusic(),
      megaChance: this.chances.megaChance,
      gigaChance: this.chances.gigaChance,
    });
    this.ui.append(this.infinite.overlay);
    // The ?perf=1 readout stays out of the picture here; __vr.perf() still reads it.
    if (this.perfOverlay) this.perfOverlay.el.hidden = true;
    this.infinite.start();
    this.renderPass.scene = this.infinite.scene;
    this.state = 'infinite';
  }

  private exitInfinite(): void {
    if (!this.infinite) return;
    this.infinite.dispose();
    this.infinite = null;
    if (this.perfOverlay) this.perfOverlay.el.hidden = false;
    this.renderPass.scene = this.scene;
    this.audio?.updateShip(0, 0, false);
    this.camera.up.set(0, 1, 0);
    this.camera.fov = 70;
    this.camera.updateProjectionMatrix();
    this.state = 'menu';
    this.screens.show('menu');
  }

  private resume(): void {
    if (this.state === 'victory') this.victoryShown = true;
    this.state = 'playing';
    this.screens.show('none');
    this.hud.show(true);
    void this.audio?.resume();
    if (!this.touchMode) this.requestLock();
  }

  private pause(): void {
    if (this.state !== 'playing' && this.state !== 'map') return;
    this.map.el.hidden = true;
    this.state = 'paused';
    this.screens.show('pause');
    this.save();
  }

  /**
   * The pause card's way back to the start menu. The hunt stays as it is: progress is saved, the
   * ship waits where it stopped, and Collect relics carries on from there.
   */
  private toMenu(): void {
    if (this.state !== 'paused') return;
    this.save();
    this.audio?.click();
    this.audio?.updateShip(0, 0, false);
    if (document.pointerLockElement) document.exitPointerLock();
    this.keys.clear();
    this.firing = false;
    this.touch.reset();
    this.hud.show(false);
    this.map.el.hidden = true;
    this.state = 'menu';
    this.screens.show('menu');
  }

  private newGalaxy(): void {
    const seed = Math.floor(Math.random() * 1e9);
    const url = new URL(window.location.href);
    url.searchParams.set('seed', String(seed));
    window.location.href = url.toString();
  }

  private applySettings(next: Settings): void {
    this.settings = next;
    writeStore(SETTINGS_KEY, JSON.stringify(next));
    this.audio?.setMusic(next.music);
    this.audio?.setMusicVolume(next.musicVolume);
    this.audio?.setSound(next.sound);
    this.infinite?.setMusic(next.music);
    this.screens.refresh();
  }

  /** The music button and M in infinite flight: the same setting as the menu's toggle, saved. */
  private toggleMusic(): void {
    this.applySettings({ ...this.settings, music: !this.settings.music });
  }

  private save(): void {
    writeStore(storageKey(this.seed), JSON.stringify(this.progress));
  }

  // --- input -----------------------------------------------------------------------------

  private setTouchMode(on: boolean): void {
    this.touchMode = on;
    document.body.classList.toggle('touch', on);
  }

  private requestLock(): void {
    const canvas = this.renderer.domElement;
    try {
      const p = canvas.requestPointerLock?.() as unknown;
      if (p instanceof Promise) p.catch(() => undefined);
    } catch {
      // Pointer lock is optional: the real cursor steers instead.
    }
  }

  private bindInput(): void {
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.renderer.domElement;
      if (was && !this.locked && (this.state === 'playing' || this.state === 'map')) this.pause();
    });
    // On a touch-first device the stick steers and FIRE fires: the mouse events a browser makes
    // up from taps would otherwise yank the nose to the tapped spot and fire a shot.
    window.addEventListener('mousemove', (e) => {
      if (this.touchMode) return;
      const radius = steerRadius(window.innerWidth, window.innerHeight);
      if (this.locked) this.cursor = moveCursor(this.cursor, e.movementX, e.movementY, radius, this.settings.sensitivity);
      else if (this.state === 'playing') {
        // No pointer lock: steer with the real cursor, scaled by sensitivity around the centre.
        const x = (e.clientX - window.innerWidth / 2) * this.settings.sensitivity;
        const y = (e.clientY - window.innerHeight / 2) * this.settings.sensitivity;
        this.cursor = moveCursor({ x: 0, y: 0 }, x, y, radius, 1);
      }
    });
    this.renderer.domElement.addEventListener('click', () => {
      if (this.state === 'playing' && !this.locked && !this.touchMode) this.requestLock();
    });
    window.addEventListener('keydown', (e) => {
      if (e.repeat && (e.code === 'KeyM' || e.code === 'Escape')) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
      if (this.state === 'infinite') {
        if (e.repeat) return;
        if (e.code === 'Escape') this.exitInfinite();
        else if (e.code === 'KeyC') this.infinite?.nextCamera();
        else if (e.code === 'KeyM') this.toggleMusic();
        else if (e.code === 'KeyH') this.infinite?.toggleNames();
        else if (e.code === 'KeyF') this.infinite?.toggleFullscreen();
        return;
      }
      this.keys.add(e.code);
      if (e.code === 'KeyM' || e.code === 'Tab') this.toggleMap();
      if (e.code === 'Escape' && !this.locked) {
        if (this.state === 'map') this.toggleMap();
        else if (this.state === 'playing') this.pause();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0 && !this.touchMode) this.firing = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.firing = false;
      this.touch.reset();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.keys.clear();
        this.touch.reset();
        if (this.state === 'playing') this.pause();
      }
    });
  }

  private toggleMap(): void {
    if (this.state === 'playing') {
      this.state = 'map';
      this.map.el.hidden = false;
    } else if (this.state === 'map') {
      this.state = 'playing';
      this.map.el.hidden = true;
    }
  }

  private readInput(): FlightInput {
    const k = this.keys;
    const touch = this.touch;
    const radius = steerRadius(window.innerWidth, window.innerHeight);
    // The stick puts the cursor where the mouse would have, so the HUD shows the same circle.
    if (this.touchMode) cursorOf(touch.aim(this.settings.sensitivity), radius, this.cursor);
    const aim = aimOf(this.cursor, radius, this.settings.invertY);
    const input = this.input;
    input.aimX = aim.x;
    input.aimY = aim.y;
    input.thrust = k.has('KeyW') || k.has('ArrowUp') || touch.thrust;
    input.brake = k.has('KeyS') || k.has('ArrowDown') || touch.brake;
    input.boost = k.has('Space') || touch.boost;
    input.strafe = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    input.roll = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    return input;
  }

  // --- frame -----------------------------------------------------------------------------

  private frame(): void {
    const startedAt = performance.now();
    if (this.perf) {
      this.perf.frame.push(startedAt - this.lastFrameAt);
      this.lastFrameAt = startedAt;
      this.renderer.info.reset();
      this.gpuTimer?.begin();
    }
    this.clock.update();
    let dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;
    if (this.stillTime !== null) {
      // Pinned clock: every animation shows the same instant, nothing moves.
      dt = 0;
      this.time = this.stillTime;
      this.shake = 0;
      this.nebulae.calm();
    }
    this.touch.setMode(!this.touchMode ? 'off' : this.state === 'playing' ? 'flight' : this.state === 'map' ? 'map' : 'off');
    if (this.state === 'infinite' && this.infinite) {
      const info = this.infinite.update(dt);
      this.sky.update(this.camera, this.renderer.getPixelRatio());
      this.audio?.updateShip(info.throttle, info.boost, false);
      this.audio?.setMood(0, info.nebula);
      this.adaptExposureTo(info.star?.position ?? null, info.star?.radius ?? 0, dt);
      this.composer.render(dt);
      if (this.perf) this.endPerfFrame(startedAt, dt);
      return;
    }
    const simulate = this.state === 'playing' || this.state === 'dead' || this.state === 'victory';

    if (simulate) this.simulate(dt);
    else if (this.state === 'menu') this.menuCamera(dt);

    if (this.state !== 'menu' && this.state !== 'loading') this.updateCamera(dt);
    this.updateVisuals(dt, simulate);

    if (this.state === 'map') {
      const fwd = forwardOf(this.flight.orientation);
      this.map.draw({ x: this.flight.position.x, z: this.flight.position.z, headingX: fwd.x, headingZ: fwd.z }, this.progress.found, this.time);
    }
    this.composer.render(dt);
    if (this.captureNext) {
      // Read the canvas in the same task as the render, before the browser clears it.
      this.captureNext(this.renderer.domElement.toDataURL('image/png'));
      this.captureNext = null;
    }
    if (this.perf) this.endPerfFrame(startedAt, dt);
  }

  private endPerfFrame(startedAt: number, dt: number): void {
    const perf = this.perf!;
    this.gpuTimer?.end();
    perf.cpu.push(performance.now() - startedAt);
    if (this.gpuTimer) for (const ms of this.gpuTimer.poll(this.gpuSamples)) perf.gpu.push(ms);
    const info = this.renderer.info;
    perf.counts = {
      calls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs?.length ?? 0,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      pixelRatio: this.renderer.getPixelRatio(),
    };
    this.perfOverlay?.update(() => perf.report(), dt > 0 ? dt : 1 / 60);
  }

  private simulate(dt: number): void {
    const f = this.flight;
    const world = this.world;
    const input = this.state === 'playing' ? this.readInput() : IDLE_INPUT;

    if (this.state === 'dead') {
      this.deadTimer -= dt;
      if (this.deadTimer <= 0) {
        this.respawn();
        this.state = 'playing';
        this.screens.show('none');
        this.hud.flash('#ffffff', 0.6);
      }
    }

    // Sub-steps keep a boosted ship from tunnelling through small rocks.
    const speed = f.velocity.length();
    const steps = Math.min(12, Math.max(1, Math.ceil((Math.max(speed, 300) * dt) / 10)));
    const h = dt / steps;
    const near = this.near;
    let hardestHit = 0;
    for (let i = 0; i < steps; i++) {
      stepFlight(f, input, h);
      if (this.state === 'dead') continue;
      const p = f.position;
      for (const c of this.grid.query(p.x, p.y, p.z, SHIP_RADIUS + 20, near)) {
        const hit = c.normal
          ? collideDisc(p, f.velocity, SHIP_RADIUS, c.position, c.normal, c.radius, c.thick ?? 4)
          : collideSphere(p, f.velocity, SHIP_RADIUS, tmpV.set(...c.position), c.radius);
        hardestHit = Math.max(hardestHit, hit);
      }
      for (const b of this.bands) hardestHit = Math.max(hardestHit, collideBand(p, f.velocity, SHIP_RADIUS, b));
      for (const pl of world.planets) {
        const hit = collideSphere(p, f.velocity, SHIP_RADIUS, tmpV.set(...pl.position), pl.radius, 0.2);
        hardestHit = Math.max(hardestHit, hit * 2);
      }
    }
    if (this.state !== 'dead' && hardestHit > 0) {
      const dmg = impactDamage(hardestHit);
      damageHull(this.hull, dmg);
      if (hardestHit > 25) {
        this.audio?.impact(hardestHit / 400);
        this.shake = Math.min(3, this.shake + hardestHit / 120);
        if (dmg > 0) this.hud.flash('rgba(255,60,40,0.9)', Math.min(0.5, dmg / 40));
      }
    }

    // Heat from the star.
    const dSun = f.position.distanceTo(tmpV.set(...world.sun.position));
    const heat = sunHeat(dSun, world.sun);
    if (this.state !== 'dead') {
      if (heat.lethal) damageHull(this.hull, Infinity);
      else damageHull(this.hull, heat.dps * dt);
      tickHull(this.hull, dt);
      this.shake = Math.max(this.shake, heat.dps > 0 ? Math.min(1.5, heat.dps / 40) : 0);
    }
    if (this.hull.destroyed && this.state !== 'dead') this.die();

    this.updateWeapons(dt);

    // Relics: pick-up and scanner.
    const neb = nebulaDensityAt([f.position.x, f.position.y, f.position.z], world.nebulae);
    const range = scanRange(neb.density);
    if (this.state === 'playing') {
      for (const a of world.artifacts) {
        if (this.progress.found.includes(a.id)) continue;
        const d = f.position.distanceTo(tmpV.set(...a.position));
        // A sealed relic cannot be picked up until its shell is shot open.
        if (d < PICKUP_RADIUS + SHIP_RADIUS && !this.sealed.has(a.id)) this.pickUp(a.id);
        else if (d < range) {
          if (!this.inScan.has(a.id)) {
            this.inScan.add(a.id);
            this.audio?.ping();
            this.hud.toast(`<b>${t(this.sealed.has(a.id) ? 'signalSealed' : 'signal')}</b>`, 'signal');
          }
        } else if (d > range * 1.15) this.inScan.delete(a.id);
      }
      this.progress.elapsed += dt;
    }

    // Warnings, tint, music mood, engine.
    let warning: Warning = 'none';
    if (heat.dps > 0) warning = 'heatCritical';
    else if (heat.level > 0) warning = 'heatRising';
    else if (this.hull.hp < 25 && !this.hull.destroyed) warning = 'hullCritical';
    this.hud.setWarning(this.state === 'dead' ? 'none' : warning);
    const nebColor = neb.nebula ? this.cssColorOf(neb.nebula.id, neb.nebula.colors[0]) : '#000';
    this.hud.setTint(nebColor, neb.density, heat.level * 0.6 + (heat.dps > 0 ? 0.3 : 0));
    this.audio?.setMood(heat.level, neb.density);
    this.audio?.updateShip(f.throttle, f.boost, heat.dps > 0 && this.state === 'playing');

    // Fog inside nebulae, tinted by the cloud.
    if (neb.nebula && neb.density > 0) {
      this.fog.color.set(neb.nebula.colors[1]).multiplyScalar(0.12);
      this.fog.density = 0.00022 * neb.density;
    } else this.fog.density = 0;

    // Location banner.
    this.regionTimer -= dt;
    if (this.regionTimer <= 0) {
      this.regionTimer = 0.5;
      const r = regionAt([f.position.x, f.position.y, f.position.z], world);
      if (r.id !== this.regionId) {
        this.regionId = r.id;
        this.hud.setRegion(t(REGION_KEYS[r.kind], { name: r.name ?? '' }), '');
      }
    }

    // Save now and then.
    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = 5;
      this.save();
    }

    // Victory once all twenty are in.
    if (isComplete(this.progress) && !this.victoryShown && this.state === 'playing') {
      this.victoryShown = true;
      window.setTimeout(() => {
        if (this.state !== 'playing') return;
        this.state = 'victory';
        this.screens.show('victory');
        if (document.pointerLockElement) document.exitPointerLock();
      }, 2500);
    }

    this.hud.setFlight(f.velocity.length(), f.throttle, this.hull.hp / this.hull.max, f.boost > 0.3);
    this.hud.setGuns(this.weapon.heat, this.weapon.overheated);
    this.updateMarkers(range);
    this.updateAim();
  }

  // --- lasers ------------------------------------------------------------------------------

  private updateWeapons(dt: number): void {
    const f = this.flight;
    const trigger = this.state === 'playing' && (this.firing || this.keys.has('KeyF') || this.touch.fire);
    const fired = stepWeapon(this.weapon, trigger, dt);
    if (fired.length > 0) {
      // Both barrels toe in to meet at a point straight ahead of the nose.
      const aim = tmpV2.copy(forwardOf(f.orientation, tmpV3)).multiplyScalar(WEAPON.convergence).add(f.position);
      for (const side of fired) {
        const mount = GUN_MOUNTS[side]!;
        const muzzle = new THREE.Vector3(mount[0], mount[1], mount[2]).applyQuaternion(f.orientation).add(f.position);
        const dir = tmpV3.copy(aim).sub(muzzle).normalize();
        this.bolts.push({
          x: muzzle.x,
          y: muzzle.y,
          z: muzzle.z,
          vx: dir.x * WEAPON.boltSpeed + f.velocity.x,
          vy: dir.y * WEAPON.boltSpeed + f.velocity.y,
          vz: dir.z * WEAPON.boltSpeed + f.velocity.z,
          life: WEAPON.boltLife,
        });
        this.fx.muzzle(muzzle);
        this.audio?.laser(side === 0 ? -0.35 : 0.35);
      }
    }
    if (this.weapon.overheated && !this.wasOverheated) this.hud.toast(`<b>${t('overheat')}</b>`, 'signal');
    this.wasOverheated = this.weapon.overheated;

    for (const hit of stepBolts(this.bolts, dt, (ax, ay, az, bx, by, bz) => this.firstHit(ax, ay, az, bx, by, bz))) this.onBoltHit(hit);
    this.fx.setBolts(this.bolts);
    this.updateLoot(dt);
  }

  /** The first solid thing on a bolt's path this frame: a target, or a planet or the star (null). */
  private firstHit(ax: number, ay: number, az: number, bx: number, by: number, bz: number): { t: number; target: Target | null } | null {
    let best: { t: number; target: Target | null } | null = null;
    const half = Math.hypot(bx - ax, by - ay, bz - az) / 2 + WEAPON.hitRadius;
    for (const c of this.grid.query((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, half, this.hitScratch)) {
      const t = c.normal
        ? segmentDisc([ax, ay, az], [bx, by, bz], c.position, c.normal, c.radius + WEAPON.hitRadius)
        : segmentSphere(ax, ay, az, bx, by, bz, c.position[0], c.position[1], c.position[2], c.radius + WEAPON.hitRadius);
      if (t !== null && (!best || t < best.t)) best = { t, target: c };
    }
    for (const b of this.bands) {
      const t = segmentBand([ax, ay, az], [bx, by, bz], b.center, b.axis, b.radius, b.width);
      if (t !== null && (!best || t < best.t)) best = { t, target: null };
    }
    for (const p of this.world.planets) {
      const t = segmentSphere(ax, ay, az, bx, by, bz, p.position[0], p.position[1], p.position[2], p.radius);
      if (t !== null && (!best || t < best.t)) best = { t, target: null };
    }
    const sun = this.world.sun;
    const ts = segmentSphere(ax, ay, az, bx, by, bz, sun.position[0], sun.position[1], sun.position[2], sun.radius);
    if (ts !== null && (!best || ts < best.t)) best = { t: ts, target: null };
    return best;
  }

  private onBoltHit(hit: BoltHit<Target>): void {
    const at = new THREE.Vector3(hit.x, hit.y, hit.z);
    const target = hit.target;
    const metal = target !== null && target.kind !== 'rock' && target.kind !== 'shell';
    this.fx.sparks(at, new THREE.Vector3(-hit.dirX, -hit.dirY, -hit.dirZ), 10, metal ? METAL_SPARK : ROCK_SPARK);
    const near = 1 - at.distanceTo(this.flight.position) / 3000;
    if (near > 0) this.audio?.hit(near);
    if (!target?.kind || target.ref === undefined) return;
    const hp = targetHp(target);
    if (!Number.isFinite(hp)) return;
    const taken = (this.damage.get(target) ?? 0) + 1;
    if (taken < hp) this.damage.set(target, taken);
    else this.breakTarget(target);
  }

  private breakTarget(target: Target): void {
    const kind = target.kind!;
    const ref = target.ref!;
    this.damage.delete(target);
    this.grid.remove(target);
    markBroken(this.progress, targetId(kind, ref));
    const at = new THREE.Vector3(...target.position);
    let radius = target.radius;
    let color = METAL_DEBRIS;
    if (kind === 'rock') {
      this.asteroids.hide(ref);
      radius = this.rocks[ref]?.radius ?? radius;
      color = ROCK_DEBRIS;
    } else if (kind === 'satellite' || kind === 'junk') {
      this.debris.hide(kind, ref);
    } else {
      this.fx.hideShell(ref);
      color = SHELL_DEBRIS;
      const a = this.world.artifacts[ref];
      if (a) this.sealed.delete(a.id);
      this.hud.toast(`<b>${t('shellBroken')}</b>`, 'found');
    }
    this.fx.shatter(at, radius, color);
    const near = 1 - at.distanceTo(this.flight.position) / 4000;
    if (near > 0) this.audio?.shatter((radius / 140) * near);
    const kindOfLoot = lootOf(this.seed, kind, ref, radius);
    if (kindOfLoot) {
      const drift = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(16);
      this.loot.push(this.fx.spawnLoot(kindOfLoot, at, drift));
    }
  }

  /** Salvage drifts until the ship comes near, then flies to it and is collected. */
  private updateLoot(dt: number): void {
    const f = this.flight;
    for (let i = this.loot.length - 1; i >= 0; i--) {
      const item = this.loot[i]!;
      const d = item.root.position.distanceTo(f.position);
      if (this.state === 'playing' && d < SHIP_RADIUS + 16) {
        this.loot.splice(i, 1);
        this.fx.removeLoot(item);
        this.progress.salvage++;
        this.hud.setSalvage(this.progress.salvage);
        this.hud.toast(`${t('salvage')}: <b>${t(item.kind === 'core' ? 'lootCore' : 'lootCrystal')}</b>`, 'found');
        this.audio?.salvage();
        continue;
      }
      if (this.state === 'playing' && d < 400) {
        const pull = tmpV.copy(f.position).sub(item.root.position).normalize().multiplyScalar(60 + (400 - d) * 0.8).add(f.velocity);
        item.v.lerp(pull, approach(4, dt));
      } else item.v.multiplyScalar(Math.exp(-0.4 * dt));
    }
  }

  private cssColorOf(id: string, color: number): string {
    let css = this.nebulaCss.get(id);
    if (css === undefined) {
      css = '#' + new THREE.Color(color).getHexString();
      this.nebulaCss.set(id, css);
    }
    return css;
  }

  private pickUp(id: string): void {
    if (!collect(this.progress, id)) return;
    const a = this.world.artifacts.find((x) => x.id === id)!;
    this.artifacts.collect(id);
    this.inScan.delete(id);
    this.audio?.pickup();
    this.hud.flash('rgba(95,245,224,0.8)', 0.45);
    this.hud.setRelics(this.progress.found.length);
    this.hud.toast(`${t('found')}: <b>${escapeHtml(a.name)}</b> · ${this.progress.found.length}/20`, 'found');
    this.save();
  }

  private die(): void {
    this.state = 'dead';
    this.deadTimer = 3.5;
    this.ship.root.visible = false;
    this.audio?.explosion();
    this.hud.flash('#ffffff', 1);
    this.shake = 3;
    this.screens.show('dead');
    this.save();
  }

  private updateMarkers(range: number): void {
    const markers = this.markers;
    markers.length = 0;
    if (this.state !== 'playing') {
      this.hud.setMarkers(markers);
      return;
    }
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    const camFwd = tmpV2.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    for (const a of this.world.artifacts) {
      if (!this.inScan.has(a.id) || this.progress.found.includes(a.id)) continue;
      const pos = tmpV.set(...a.position);
      const distance = pos.distanceTo(this.flight.position);
      if (distance > range * 1.15) continue;
      const toA = tmpV3.copy(pos).sub(this.camera.position);
      const inFront = toA.dot(camFwd) > 0;
      const ndc = tmpV4.copy(pos).project(this.camera);
      let x = (ndc.x * 0.5 + 0.5) * w;
      let y = (-ndc.y * 0.5 + 0.5) * hgt;
      const onScreen = inFront && Math.abs(ndc.x) < 0.94 && Math.abs(ndc.y) < 0.9;
      let angle = 0;
      if (!onScreen) {
        let dx = ndc.x;
        let dy = -ndc.y;
        if (!inFront) {
          dx = -dx;
          dy = -dy;
        }
        angle = Math.atan2(dy * hgt, dx * w);
        x = Math.min(w - 110, Math.max(110, w / 2 + Math.cos(angle) * w * 0.42));
        y = Math.min(hgt - 140, Math.max(120, hgt / 2 + Math.sin(angle) * hgt * 0.4));
      }
      const m = (this.markerPool[markers.length] ??= { x: 0, y: 0, distance: 0, edge: false, angle: 0 });
      m.x = x;
      m.y = y;
      m.distance = distance;
      m.edge = !onScreen;
      m.angle = angle;
      markers.push(m);
    }
    this.hud.setMarkers(markers);
  }

  /** The red cross where both barrels converge. */
  private updateAim(): void {
    const f = this.flight;
    const p = tmpV.copy(forwardOf(f.orientation, tmpV2)).multiplyScalar(WEAPON.convergence).add(f.position).project(this.camera);
    const visible = this.state === 'playing' && p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1;
    this.hud.setAim((p.x * 0.5 + 0.5) * window.innerWidth, (-p.y * 0.5 + 0.5) * window.innerHeight, visible);
  }

  private updateCamera(dt: number): void {
    const f = this.flight;
    this.camQuat.slerp(f.orientation, approach(4.5, dt));
    const offset = tmpV.copy(CAMERA_OFFSET);
    offset.z += f.boost * 10;
    offset.applyQuaternion(this.camQuat);
    this.camera.position.copy(f.position).add(offset);
    this.camera.quaternion.copy(this.camQuat);
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    const fov = 68 + f.boost * 14;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private menuCamera(dt: number): void {
    this.menuAngle += dt * 0.06;
    const f = this.flight;
    const r = 46;
    const local = tmpV.set(Math.sin(this.menuAngle) * r, 10 + Math.sin(this.menuAngle * 0.7) * 6, Math.cos(this.menuAngle) * r);
    local.applyQuaternion(f.orientation);
    this.camera.position.copy(f.position).add(local);
    this.camera.up.set(0, 1, 0).applyQuaternion(f.orientation);
    this.camera.lookAt(tmpV2.copy(forwardOf(f.orientation)).multiplyScalar(14).add(f.position));
  }

  private updateVisuals(dt: number, simulate: boolean): void {
    const f = this.flight;
    const t = this.time;
    this.sky.update(this.camera, this.renderer.getPixelRatio());
    this.fill.position.copy(this.camera.position);
    this.fill.target.position.copy(f.position);
    this.sun.update(t, this.camera);
    for (const p of this.planets) p.update(t);
    this.nebulae.update(t, dt);
    this.wrecks.update(t);
    this.debris.update(t, dt);
    for (const s of this.structures) s.update(t, dt);
    this.giga?.update(t, dt);
    this.fx.update(dt, t);
    this.artifacts.update(t, dt, window.innerHeight * this.renderer.getPixelRatio());
    this.ship.root.position.copy(f.position);
    this.ship.root.quaternion.copy(f.orientation);
    this.bank += (f.spin.y * 0.55 - this.bank) * approach(4, dt);
    const idle = this.state === 'menu' ? 0.35 : 0;
    this.ship.update(t, Math.max(f.throttle, idle), f.boost, this.bank);
    const tint = this.fog.density > 0 ? NEBULA_DUST : WHITE;
    this.dust.update(this.camera, f.velocity, tint);
    if (simulate || this.state === 'menu') {
      const radius = steerRadius(window.innerWidth, window.innerHeight);
      this.hud.setCursor(this.cursor.x, this.cursor.y, radius, this.state === 'playing');
    }
    this.adaptExposure(dt);
    this.hud.tick(dt);
  }

  /** Eye adaptation near the star: lower exposure and bloom the more of the view it fills. */
  private exposure = 1;
  private adaptExposure(dt: number): void {
    this.adaptExposureTo(tmpV.set(...this.world.sun.position), this.world.sun.radius, dt);
  }

  /** The same for any star (or none, which relaxes toward normal exposure). */
  private adaptExposureTo(star: THREE.Vector3 | null, radius: number, dt: number): void {
    let target = 1;
    if (star) {
      const toSun = tmpV2.copy(star).sub(this.camera.position);
      const distance = toSun.length();
      const fwd = tmpV3.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const offAxis = Math.acos(THREE.MathUtils.clamp(fwd.dot(toSun.normalize()), -1, 1));
      target = targetExposure({ starRadius: radius, distance, offAxis, fov: this.camera.fov, aspect: this.camera.aspect });
    }
    // A pinned clock snaps straight to the target so repeated captures match exactly.
    this.exposure = this.stillTime !== null ? target : stepExposure(this.exposure, target, dt);
    this.renderer.toneMappingExposure = this.exposure;
    this.bloom.strength = 0.8 * this.exposure * this.exposure;
  }

  private onResize(): void {
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    // A hidden or minimised window can report 0×0; keep the last real size instead.
    if (w === 0 || hgt === 0) return;
    this.renderer.setSize(w, hgt, false);
    this.composer.setSize(w, hgt);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.bloom.resolution.set(w, hgt);
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
  }

  /** ?debug=1: a handle for poking the game from the console. */
  private exposeDebug(): void {
    const self = this;
    const teleport = (x: number, y: number, z: number, lookAt?: [number, number, number]) => {
      const look = lookAt ? new THREE.Vector3(...lookAt) : new THREE.Vector3(0, 0, 0);
      self.flight = createFlightState(new THREE.Vector3(x, y, z), look);
      self.camQuat.copy(self.flight.orientation);
    };
    const play = () => {
      self.state = 'playing';
      self.screens.show('none');
      self.hud.show(true);
    };
    (window as unknown as Record<string, unknown>)['__vr'] = {
      world: this.world,
      scene: this.scene,
      renderer: this.renderer,
      composer: this.composer,
      get state() {
        return self.state;
      },
      get progress() {
        return self.progress;
      },
      get hull() {
        return self.hull;
      },
      teleport(x: number, y: number, z: number, lookAt?: [number, number, number]) {
        teleport(x, y, z, lookAt);
      },
      play() {
        play();
      },
      press(code: string, down = true) {
        if (down) self.keys.add(code);
        else self.keys.delete(code);
      },
      aim(x: number, y: number) {
        self.cursor = { x, y };
      },
      fire(on: boolean) {
        self.firing = on;
      },
      /** Forces the touch controls on or off, e.g. to see them in a desktop window. */
      touch(on: boolean) {
        self.setTouchMode(on);
        self.screens.refresh();
      },
      get rocks() {
        return self.rocks;
      },
      get infinite() {
        return self.infinite;
      },
      map(open: boolean) {
        if (open !== (self.state === 'map')) self.toggleMap();
      },
      /** Fly to a benchmark spot ('spawn' | 'nebula' | 'belt' | 'star'), stopped, in play. */
      spot(name: BenchSpotName) {
        if (!BENCH_SPOTS.includes(name)) throw new Error(`spot: one of ${BENCH_SPOTS.join(', ')}`);
        const s = benchSpot(self.world, name);
        teleport(...s.position, s.lookAt);
        play();
        self.keys.clear();
        self.cursor = { x: 0, y: 0 };
        return s;
      },
      /** With ?perf=1: the rolling frame report, and a way to start a fresh window. */
      perf() {
        return self.perf?.report() ?? null;
      },
      perfReset() {
        self.perf?.reset();
        self.lastFrameAt = NaN;
      },
      /**
       * Render `frames` frames back to back, each waited for with a 1-pixel read: the true cost
       * of a frame with the GPU at full clock, independent of vsync and of a throttled tab.
       */
      benchSync(frames = 120, warmup = 20) {
        const gl = self.renderer.getContext();
        const px = new Uint8Array(4);
        const run = (n: number) => {
          for (let i = 0; i < n; i++) {
            self.frame();
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          }
        };
        run(warmup);
        self.perf?.reset();
        self.lastFrameAt = NaN;
        const t0 = performance.now();
        run(frames);
        const ms = (performance.now() - t0) / frames;
        return { ms, report: self.perf?.report() ?? null };
      },
      /** Pin the clock at t seconds (null to let it run): the same picture on every run. */
      still(t: number | null) {
        self.stillTime = t === null || !Number.isFinite(t) ? null : t;
      },
      /** A PNG data URL of the next rendered frame. */
      capture(): Promise<string> {
        return new Promise((resolve) => {
          self.captureNext = resolve;
        });
      },
    };
  }
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpV3 = new THREE.Vector3();
const tmpV4 = new THREE.Vector3();
const IDLE_INPUT: Readonly<FlightInput> = Object.freeze({ aimX: 0, aimY: 0, thrust: false, brake: false, boost: false, strafe: 0, roll: 0 });
const WHITE = new THREE.Color(1, 1, 1);
const NEBULA_DUST = new THREE.Color(1.0, 0.85, 1.0);

/** Probed on a throwaway canvas: the game canvas must get its context from three, once. */
function supportsReversedDepth(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ok = !!gl?.getExtension('EXT_clip_control');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch {
    return false;
  }
}
const ROCK_SPARK = new THREE.Color(2.4, 1.3, 0.6);
const METAL_SPARK = new THREE.Color(2.2, 2.0, 1.6);
const ROCK_DEBRIS = new THREE.Color(0.55, 0.5, 0.45);
const METAL_DEBRIS = new THREE.Color(0.62, 0.64, 0.68);
const SHELL_DEBRIS = new THREE.Color(0.24, 0.24, 0.27);

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

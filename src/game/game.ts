import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AudioEngine } from '../audio/engine.ts';
import { nameOf, setLang, t } from '../i18n/i18n.ts';
import type { Key } from '../i18n/strings.ts';
import { createArtifacts, type ArtifactView } from '../render/artifacts.ts';
import { createAsteroids } from '../render/asteroids.ts';
import { createDust, type DustView } from '../render/dust.ts';
import { createNebulae, type NebulaView } from '../render/nebula.ts';
import { createPlanet, type PlanetView } from '../render/planets.ts';
import { SHIP_RADIUS, createShip, type ShipView } from '../render/ship.ts';
import { createSky, type Sky } from '../render/sky.ts';
import { createSun, type SunView } from '../render/sun.ts';
import { createWrecks, type Collider, type WreckView } from '../render/wrecks.ts';
import { createHud, type Hud, type Marker, type Warning } from '../ui/hud.ts';
import { createMap, type MapView } from '../ui/map.ts';
import { createScreens } from '../ui/screens.ts';
import { generateAsteroids, generateWorld, type World } from '../world/generate.ts';
import { nebulaDensityAt, regionAt, scanRange, type Region } from '../world/regions.ts';
import { aimOf, moveCursor, steerRadius, type Cursor } from './aim.ts';
import { approach, createFlightState, forwardOf, stepFlight, type FlightInput, type FlightState } from './flight.ts';
import { collideSphere, createHull, damageHull, impactDamage, repairHull, sunHeat, tickHull, type Hull } from './hazards.ts';
import { PICKUP_RADIUS, collect, formatTime, isComplete, parseProgress, storageKey, type Progress } from './progress.ts';
import { SETTINGS_KEY, writeStore, readStore, type Settings } from './settings.ts';
import { SpatialHash } from './spatialHash.ts';

type State = 'loading' | 'menu' | 'playing' | 'paused' | 'map' | 'dead' | 'victory';

const REGION_KEYS: Record<Region['kind'], Key> = {
  star: 'regionStar',
  wreck: 'regionWreck',
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
  private readonly bloom: UnrealBloomPass;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(70, 1, 0.5, 2_000_000);
  private readonly clock = new THREE.Timer();
  private readonly ui: HTMLElement;
  private fill!: THREE.DirectionalLight;

  private world!: World;
  private grid!: SpatialHash<Collider>;
  private sky!: Sky;
  private sun!: SunView;
  private planets: PlanetView[] = [];
  private nebulae!: NebulaView;
  private wrecks!: WreckView;
  private artifacts!: ArtifactView;
  private ship!: ShipView;
  private dust!: DustView;
  private hud!: Hud;
  private map!: MapView;
  private readonly screens: ReturnType<typeof createScreens>;

  private flight!: FlightState;
  private hull: Hull = createHull();
  private progress!: Progress;
  private audio: AudioEngine | null = null;

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
  private time = 0;
  private menuAngle = 0;
  private victoryShown = false;

  private readonly seed: number;
  private settings: Settings;
  private readonly debug: boolean;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement, seed: number, settings: Settings, debug: boolean) {
    this.ui = ui;
    this.seed = seed;
    this.settings = settings;
    this.debug = debug;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.8, 0.55, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    setLang(settings.lang);
    this.screens = createScreens(
      {
        onLaunch: () => this.launch(),
        onNewGalaxy: () => this.newGalaxy(),
        onResume: () => this.resume(),
        onKeepFlying: () => this.resume(),
        onSettings: (next) => this.applySettings(next),
      },
      () => ({
        seed: this.seed,
        found: this.progress?.found.length ?? 0,
        settings: this.settings,
        victoryTime: formatTime(this.progress?.finishedAt ?? this.progress?.elapsed ?? 0),
        touchOnly: window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches,
      }),
    );
    this.ui.append(this.screens.el);
    this.screens.show('loading');
    this.screens.refresh();
  }

  /** Builds the whole system. Split across frames so the loading text gets painted first. */
  async build(): Promise<void> {
    await nextFrame();
    const world = generateWorld(this.seed);
    this.world = world;
    const rocks = generateAsteroids(world);

    this.sky = createSky(this.renderer, this.seed);
    this.scene.background = this.sky.background;
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

    this.scene.add(createAsteroids(rocks, this.seed).group);
    this.wrecks = createWrecks(world.wrecks);
    this.scene.add(this.wrecks.group);
    await nextFrame();

    this.nebulae = createNebulae(world.nebulae, this.seed);
    this.scene.add(this.nebulae.group);

    this.artifacts = createArtifacts(world.artifacts);
    this.scene.add(this.artifacts.group);

    this.ship = createShip(this.sky.background);
    this.scene.add(this.ship.root);
    this.dust = createDust();
    this.scene.add(this.dust.lines);

    const colliders: Collider[] = rocks.map((r) => ({ position: r.position, radius: r.radius * 0.92 }));
    colliders.push(...this.wrecks.colliders);
    this.grid = new SpatialHash(600, colliders);

    const ids = new Set(world.artifacts.map((a) => a.id));
    this.progress = parseProgress(readStore(storageKey(this.seed)), this.seed, ids);
    this.artifacts.setFound(this.progress.found);
    this.victoryShown = isComplete(this.progress);

    this.hud = createHud();
    this.map = createMap(world, rocks);
    this.ui.prepend(this.hud.el, this.map.el);
    this.hud.setRelics(this.progress.found.length);
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

  private async launch(): Promise<void> {
    if (!this.audio) {
      try {
        this.audio = new AudioEngine(this.seed);
        this.audio.setMusic(this.settings.music);
        this.audio.setSound(this.settings.sound);
        this.audio.start();
      } catch {
        this.audio = null;
      }
    }
    void this.audio?.resume();
    this.audio?.click();
    this.state = 'playing';
    this.screens.show('none');
    this.hud.show(true);
    this.regionId = '';
    this.requestLock();
  }

  private resume(): void {
    if (this.state === 'victory') this.victoryShown = true;
    this.state = 'playing';
    this.screens.show('none');
    this.hud.show(true);
    void this.audio?.resume();
    this.requestLock();
  }

  private pause(): void {
    if (this.state !== 'playing' && this.state !== 'map') return;
    this.map.el.hidden = true;
    this.state = 'paused';
    this.screens.show('pause');
    this.save();
  }

  private newGalaxy(): void {
    const seed = Math.floor(Math.random() * 1e9);
    const url = new URL(window.location.href);
    url.searchParams.set('seed', String(seed));
    window.location.href = url.toString();
  }

  private applySettings(next: Settings): void {
    const langChanged = next.lang !== this.settings.lang;
    this.settings = next;
    writeStore(SETTINGS_KEY, JSON.stringify(next));
    this.audio?.setMusic(next.music);
    this.audio?.setSound(next.sound);
    if (langChanged) {
      setLang(next.lang);
      this.hud.relabel();
      this.map.relabel();
      this.hud.setSeedLine(t('galaxy', { seed: this.seed }));
      this.regionId = '';
    }
    this.screens.refresh();
  }

  private save(): void {
    writeStore(storageKey(this.seed), JSON.stringify(this.progress));
  }

  // --- input -----------------------------------------------------------------------------

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
    window.addEventListener('mousemove', (e) => {
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
      if (this.state === 'playing' && !this.locked) this.requestLock();
    });
    window.addEventListener('keydown', (e) => {
      if (e.repeat && (e.code === 'KeyM' || e.code === 'Escape')) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.code === 'KeyM' || e.code === 'Tab') this.toggleMap();
      if (e.code === 'Escape' && !this.locked) {
        if (this.state === 'map') this.toggleMap();
        else if (this.state === 'playing') this.pause();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.keys.clear();
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
    const radius = steerRadius(window.innerWidth, window.innerHeight);
    const aim = aimOf(this.cursor, radius, this.settings.invertY);
    return {
      aimX: aim.x,
      aimY: aim.y,
      thrust: k.has('KeyW') || k.has('ArrowUp'),
      brake: k.has('KeyS') || k.has('ArrowDown'),
      boost: k.has('Space'),
      strafe: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
      roll: (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0),
    };
  }

  // --- frame -----------------------------------------------------------------------------

  private frame(): void {
    this.clock.update();
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;
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
  }

  private simulate(dt: number): void {
    const f = this.flight;
    const world = this.world;
    const input: FlightInput =
      this.state === 'playing' ? this.readInput() : { aimX: 0, aimY: 0, thrust: false, brake: false, boost: false, strafe: 0, roll: 0 };

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
    const near: Collider[] = [];
    let hardestHit = 0;
    for (let i = 0; i < steps; i++) {
      stepFlight(f, input, h);
      if (this.state === 'dead') continue;
      const p = f.position;
      for (const c of this.grid.query(p.x, p.y, p.z, SHIP_RADIUS + 20, near)) {
        const hit = collideSphere(p, f.velocity, SHIP_RADIUS, tmpV.set(...c.position), c.radius);
        hardestHit = Math.max(hardestHit, hit);
      }
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

    // Relics: pick-up and scanner.
    const neb = nebulaDensityAt([f.position.x, f.position.y, f.position.z], world.nebulae);
    const range = scanRange(neb.density);
    if (this.state === 'playing') {
      for (const a of world.artifacts) {
        if (this.progress.found.includes(a.id)) continue;
        const d = f.position.distanceTo(tmpV.set(...a.position));
        if (d < PICKUP_RADIUS + SHIP_RADIUS) this.pickUp(a.id);
        else if (d < range) {
          if (!this.inScan.has(a.id)) {
            this.inScan.add(a.id);
            this.audio?.ping();
            this.hud.toast(`<b>${t('signal')}</b>`, 'signal');
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
    const nebColor = neb.nebula ? '#' + new THREE.Color(neb.nebula.colors[0]).getHexString() : '#000';
    this.hud.setTint(nebColor, neb.density, heat.level * 0.6 + (heat.dps > 0 ? 0.3 : 0));
    this.audio?.setMood(heat.level, neb.density);
    this.audio?.updateShip(f.throttle, f.boost, heat.dps > 0 && this.state === 'playing');

    // Fog inside nebulae, tinted by the cloud.
    if (neb.nebula && neb.density > 0) {
      const color = new THREE.Color(neb.nebula.colors[1]).multiplyScalar(0.12);
      if (!(this.scene.fog instanceof THREE.FogExp2)) this.scene.fog = new THREE.FogExp2(color, 0);
      const fog = this.scene.fog as THREE.FogExp2;
      fog.color.copy(color);
      fog.density = 0.00022 * neb.density;
    } else this.scene.fog = null;

    // Location banner.
    this.regionTimer -= dt;
    if (this.regionTimer <= 0) {
      this.regionTimer = 0.5;
      const r = regionAt([f.position.x, f.position.y, f.position.z], world);
      if (r.id !== this.regionId) {
        this.regionId = r.id;
        this.hud.setRegion(t(REGION_KEYS[r.kind], { name: r.name ? nameOf(r.name) : '' }), '');
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
    this.updateMarkers(range);
  }

  private pickUp(id: string): void {
    if (!collect(this.progress, id)) return;
    const a = this.world.artifacts.find((x) => x.id === id)!;
    this.artifacts.collect(id);
    this.inScan.delete(id);
    this.audio?.pickup();
    this.hud.flash('rgba(95,245,224,0.8)', 0.45);
    this.hud.setRelics(this.progress.found.length);
    this.hud.toast(`${t('found')}: <b>${escapeHtml(nameOf(a.name))}</b> · ${this.progress.found.length}/20`, 'found');
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
    const markers: Marker[] = [];
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
      const ndc = pos.clone().project(this.camera);
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
      markers.push({ x, y, distance, edge: !onScreen, angle });
    }
    this.hud.setMarkers(markers);
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
    for (const p of this.planets) p.update(dt, t);
    this.nebulae.update(t, dt);
    this.wrecks.update(t);
    this.artifacts.update(t, dt, window.innerHeight * this.renderer.getPixelRatio());
    this.ship.root.position.copy(f.position);
    this.ship.root.quaternion.copy(f.orientation);
    this.bank += (f.spin.y * 0.55 - this.bank) * approach(4, dt);
    const idle = this.state === 'menu' ? 0.35 : 0;
    this.ship.update(t, Math.max(f.throttle, idle), f.boost, this.bank);
    const tint = this.scene.fog ? new THREE.Color(1.0, 0.85, 1.0) : WHITE;
    this.dust.update(this.camera, f.velocity, tint);
    if (simulate || this.state === 'menu') {
      const radius = steerRadius(window.innerWidth, window.innerHeight);
      this.hud.setCursor(this.cursor.x, this.cursor.y, radius, this.state === 'playing');
    }
    this.adaptExposure(dt);
    this.hud.tick(dt);
  }

  /** Eye adaptation: the more of the view the star fills, the lower the exposure and bloom. */
  private exposure = 1;
  private adaptExposure(dt: number): void {
    const sunPos = tmpV.set(...this.world.sun.position);
    const toSun = tmpV2.copy(sunPos).sub(this.camera.position);
    const d = Math.max(toSun.length(), this.world.sun.radius * 1.001);
    toSun.divideScalar(d);
    const fwd = tmpV3.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const angular = Math.asin(this.world.sun.radius / d);
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2) * Math.max(1, this.camera.aspect);
    const off = Math.acos(THREE.MathUtils.clamp(fwd.dot(toSun), -1, 1));
    const inView = THREE.MathUtils.clamp(1 - (off - angular) / halfFov, 0, 1);
    const size = THREE.MathUtils.clamp(angular / 0.35, 0, 1);
    const coverage = inView * (0.25 + 0.75 * size);
    const target = 1 - 0.72 * coverage;
    this.exposure += (target - this.exposure) * approach(2.5, dt);
    this.renderer.toneMappingExposure = this.exposure;
    this.bloom.strength = 0.8 * this.exposure * this.exposure;
  }

  private onResize(): void {
    const w = window.innerWidth;
    const hgt = window.innerHeight;
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
    (window as unknown as Record<string, unknown>)['__vr'] = {
      world: this.world,
      scene: this.scene,
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
        const look = lookAt ? new THREE.Vector3(...lookAt) : new THREE.Vector3(0, 0, 0);
        self.flight = createFlightState(new THREE.Vector3(x, y, z), look);
        self.camQuat.copy(self.flight.orientation);
      },
      play() {
        self.state = 'playing';
        self.screens.show('none');
        self.hud.show(true);
      },
      press(code: string, down = true) {
        if (down) self.keys.add(code);
        else self.keys.delete(code);
      },
      aim(x: number, y: number) {
        self.cursor = { x, y };
      },
      map(open: boolean) {
        if (open !== (self.state === 'map')) self.toggleMap();
      },
    };
  }
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpV3 = new THREE.Vector3();
const WHITE = new THREE.Color(1, 1, 1);

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

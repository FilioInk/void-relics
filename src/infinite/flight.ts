import * as THREE from 'three';
import { approach } from '../game/flight.ts';
import { SpatialHash } from '../game/spatialHash.ts';
import { segmentSphere, stepBolts, targetHp, type Bolt, type Target } from '../game/targets.ts';
import { WEAPON, createWeapon, stepWeapon } from '../game/weapons.ts';
import { createCombatFx, type CombatFx } from '../render/combat.ts';
import { createDust, type DustView } from '../render/dust.ts';
import { GUN_MOUNTS, createShip, type ShipView } from '../render/ship.ts';
import { starFacts, t } from '../text.ts';
import { h, icon } from '../ui/dom.ts';
import { createFullscreenButton, toggleFullscreen, type FullscreenButton } from '../ui/fullscreen.ts';
import { starLook, type Star } from '../world/stars.ts';
import { Director, SEGMENT, cruiseSpeed, distance, starPresence, wantedSegments, type Segment } from './director.ts';
import { disposeChunk, planChunk, rebaseChunk, type Chunk } from './stream.ts';

/**
 * Infinite flight: the ship flies itself down an endless path while the director lays out
 * fields, nebulae, planets, stars and ruins ahead of it. The camera cuts between a few
 * cinematic angles, and in asteroid fields the autopilot picks off rocks now and then.
 *
 * The flight itself is simulated in absolute coordinates (plain JS doubles); the scene is drawn
 * relative to an origin that jumps forward every so often, so the GPU never sees huge numbers.
 */

export type CameraMode = 'chase' | 'orbit' | 'flyby' | 'wide' | 'cockpit';
const CAMERA_ORDER: CameraMode[] = ['chase', 'orbit', 'flyby', 'chase', 'wide', 'cockpit'];

/** What the game needs back each frame: engine, music mood, exposure and screen tint. */
export type FlightFrame = {
  throttle: number;
  boost: number;
  /** The nearest star, in scene coordinates, for exposure. */
  star: { position: THREE.Vector3; radius: number } | null;
  /** 0..1 how deep in a nebula, and its colours. */
  nebula: number;
  nebulaColors: [number, number] | null;
};

export type FlightSounds = { laser(pan: number): void; hit(strength: number): void; shatter(size: number): void };

const REBASE_AT = 40000;
const BUILD_BUDGET_MS = 6;

export class InfiniteFlight {
  readonly scene = new THREE.Scene();
  // On the scene from the start, thinned to zero outside nebulae: adding it at the first nebula
  // would make every material pick a new shader mid-flight (a hitch).
  private readonly fog = new THREE.FogExp2(0x000000, 0);
  readonly overlay: HTMLElement;
  private readonly director: Director;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly sounds: () => FlightSounds | null;
  private readonly envMap: THREE.Texture | null;
  private readonly seed: number;
  private readonly origin = new THREE.Vector3();
  private readonly chunks = new Map<number, Chunk>();
  private readonly ship: ShipView;
  private readonly dust: DustView;
  private readonly fx: CombatFx;
  private readonly stars: THREE.Points;
  private readonly key: THREE.DirectionalLight;
  private readonly fill: THREE.DirectionalLight;
  /** The key light each star casts, worked out once per star. */
  private readonly keys = new WeakMap<Star, { color: THREE.Color; intensity: number }>();

  private s = 0;
  private speed = 200;
  private time = 0;
  private bank = 0;
  private mode: CameraMode = 'chase';
  private modeIndex = 0;
  private modeTimer = 22;
  private readonly camQuat = new THREE.Quaternion();
  private readonly flybyAt = new THREE.Vector3();
  private orbitAngle = 0;
  private segmentShown = -1;
  private lastShot = -100;

  // The autopilot's guns.
  private readonly weapon = createWeapon();
  private readonly bolts: Bolt[] = [];
  private readonly grid = new SpatialHash<Target>(600);
  private readonly damage = new Map<Target, number>();
  private readonly owner = new Map<Target, Chunk>();
  private target: Target | null = null;
  private burst = 0;
  private pause = 3;
  private readonly scratch: Target[] = [];

  // Overlay: the flight, the name of each new place as it fades in (H hides them), and the
  // music and full-screen buttons, which fade out with the cursor while the pointer rests. On a
  // touch device a camera button joins them and a back button sits top-left: a tap brings them
  // all back.
  private readonly caption: HTMLElement;
  private readonly fullscreen: FullscreenButton;
  private readonly musicButton: HTMLButtonElement;
  private namesOn = true;
  private idleTimer = 0;
  private readonly wake = (): void => {
    this.overlay.classList.remove('idle');
    document.body.classList.remove('cursor-idle');
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      this.overlay.classList.add('idle');
      document.body.classList.add('cursor-idle');
    }, IDLE_MS);
  };

  // Pose, absolute coordinates.
  private readonly pos = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly velocity = new THREE.Vector3();

  constructor(opts: {
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    envMap: THREE.CubeTexture;
    stars: THREE.Points;
    seed: number;
    sounds: () => FlightSounds | null;
    onBack: () => void;
    /** Whether the music plays now, for the music button's icon. */
    music: boolean;
    onMusic: () => void;
  }) {
    this.renderer = opts.renderer;
    this.camera = opts.camera;
    this.sounds = opts.sounds;
    this.envMap = opts.envMap;
    this.seed = opts.seed;
    this.director = new Director(opts.seed);

    this.scene.background = opts.envMap;
    this.scene.fog = this.fog;
    this.stars = opts.stars.clone();
    this.scene.add(this.stars);
    this.scene.add(new THREE.AmbientLight(0x8090b0, 0.14));
    this.scene.add(new THREE.HemisphereLight(0x324058, 0x0a0806, 0.25));
    // One key light standing in for whichever star the story is near.
    this.key = new THREE.DirectionalLight(DEFAULT_KEY.color, DEFAULT_KEY.intensity);
    this.fill = new THREE.DirectionalLight(0x9fb4d8, 0.55);
    this.scene.add(this.key, this.key.target, this.fill, this.fill.target);

    this.ship = createShip(opts.envMap);
    this.scene.add(this.ship.root);
    this.dust = createDust();
    this.scene.add(this.dust.lines);
    this.fx = createCombatFx();
    this.scene.add(this.fx.group);

    this.caption = h('div', { class: 'inf-caption' });
    this.fullscreen = createFullscreenButton('inf-btn inf-fs');
    const touchButton = (cls: string, label: string, path: string, onclick: () => void) => {
      const b = h('button', { class: `inf-btn inf-touch ${cls}`, type: 'button', title: label, 'aria-label': label, onclick });
      b.innerHTML = icon(path);
      return b;
    };
    const camera = touchButton('inf-cam', t('infCamera'), ICON_CAMERA, () => this.nextCamera());
    const back = touchButton('inf-back', t('infBack'), ICON_BACK, () => opts.onBack());
    this.musicButton = h('button', { class: 'inf-btn inf-music', type: 'button', onclick: () => opts.onMusic() });
    this.setMusic(opts.music);
    this.overlay = h('div', { class: 'inf' }, this.caption, back, h('div', { class: 'inf-tools' }, camera, this.musicButton, this.fullscreen.el));
  }

  /** The music button's icon: a note, struck through while the music is off. */
  setMusic(on: boolean): void {
    const b = this.musicButton;
    const label = t(on ? 'infMusicOff' : 'infMusicOn');
    b.innerHTML = icon(on ? ICON_MUSIC : ICON_MUSIC + ICON_STRIKE);
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('off', !on);
  }

  /** Builds the first stretches at once and compiles their shaders, so the flight starts smooth. */
  start(): void {
    for (const i of wantedSegments(0)) this.load(i, true);
    this.pose(0);
    this.placeCamera(0, true);
    this.renderer.compile(this.scene, this.camera);
    window.addEventListener('pointermove', this.wake);
    window.addEventListener('pointerdown', this.wake);
    this.wake();
  }

  nextCamera(): void {
    // A chosen camera stays a while before the autopilot cuts again.
    this.modeTimer = 45;
    this.modeIndex = (this.modeIndex + 1) % CAMERA_ORDER.length;
    this.setMode(CAMERA_ORDER[this.modeIndex]!);
  }

  /** H: hides the place names for a picture with nothing on it, or brings them back. */
  toggleNames(): void {
    this.namesOn = !this.namesOn;
    this.overlay.classList.toggle('quiet', !this.namesOn);
  }

  /** F, from a key press: the browser allows full screen only from a user gesture. */
  toggleFullscreen(): void {
    void toggleFullscreen(document);
  }

  dispose(): void {
    for (const c of this.chunks.values()) disposeChunk(c, this.scene);
    this.chunks.clear();
    window.removeEventListener('pointermove', this.wake);
    window.removeEventListener('pointerdown', this.wake);
    window.clearTimeout(this.idleTimer);
    document.body.classList.remove('cursor-idle');
    this.fullscreen.dispose();
    this.overlay.remove();
  }

  // --- the frame -----------------------------------------------------------------------------

  update(dt: number): FlightFrame {
    this.time += dt;
    const seg = this.director.segment(Math.floor(this.s / SEGMENT));
    this.speed += (cruiseSpeed(seg.kind) - this.speed) * approach(0.35, dt);
    this.s += this.speed * dt;
    this.pose(dt);
    this.stream();
    if (this.pos.distanceTo(this.origin) > REBASE_AT && seg.kind !== 'field' && this.time - this.lastShot > 8) this.rebase();
    this.autopilotGuns(dt);
    this.placeCamera(dt, false);
    this.updateVisuals(dt);
    if (seg.index !== this.segmentShown) this.announce(seg);
    return this.frameInfo();
  }

  private pose(dt: number): void {
    const path = this.director.path;
    const p = path.at(this.s);
    const f = path.tangent(this.s);
    const ahead = path.tangent(this.s + 300);
    this.velocity.set(f[0], f[1], f[2]).multiplyScalar(this.speed);
    this.pos.set(p[0], p[1], p[2]);
    this.fwd.set(f[0], f[1], f[2]);
    // Lean into the turn, the way a pilot would: positive banks left, for a turn to the left.
    const turnLeft = f[2] * ahead[0] - f[0] * ahead[2];
    this.bank += (THREE.MathUtils.clamp(turnLeft * 40, -0.6, 0.6) - this.bank) * approach(1.5, dt || 1);
    // Matrix4.lookAt(eye, target) points +Z from the target to the eye, which leaves -Z, the
    // ship's nose, pointing along the direction of travel.
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), this.fwd, new THREE.Vector3(0, 1, 0));
    this.quat.setFromRotationMatrix(m).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.bank));
  }

  private stream(): void {
    const wanted = new Set(wantedSegments(this.s));
    for (const [i, c] of this.chunks) {
      if (wanted.has(i)) continue;
      for (const t of c.targets) {
        this.grid.remove(t);
        this.owner.delete(t);
        this.damage.delete(t);
      }
      if (this.target && this.owner.get(this.target) === undefined) this.target = null;
      disposeChunk(c, this.scene);
      this.chunks.delete(i);
    }
    for (const i of wanted) if (!this.chunks.has(i)) this.load(i, false);
    // Spend a few milliseconds a frame building what is queued, nearest segment first.
    const started = performance.now();
    for (const i of [...this.chunks.keys()].sort((a, b) => a - b)) {
      const c = this.chunks.get(i)!;
      while (c.jobs.length > 0 && performance.now() - started < BUILD_BUDGET_MS) {
        c.jobs.shift()!();
        this.register(c);
      }
    }
  }

  private load(i: number, now: boolean): void {
    const segment = this.director.segment(i);
    const chunk = planChunk(segment, {
      scene: this.scene,
      path: this.director.path,
      envMap: this.envMap,
      seed: this.seed,
      origin: this.origin,
      added: (o) => {
        // Hidden until its shaders are ready, so a new planet never stalls a frame.
        if (now) return;
        o.visible = false;
        this.renderer
          .compileAsync(o, this.camera, this.scene)
          .then(() => (o.visible = true))
          .catch(() => (o.visible = true));
      },
    });
    this.chunks.set(i, chunk);
    if (now) {
      while (chunk.jobs.length > 0) chunk.jobs.shift()!();
      this.register(chunk);
    }
  }

  /** Puts a chunk's new breakable rocks into the grid the guns aim with. */
  private register(c: Chunk): void {
    for (const t of c.targets) {
      if (this.owner.has(t)) continue;
      this.owner.set(t, c);
      this.grid.insert(t);
    }
  }

  private rebase(): void {
    const shift = this.pos.clone().sub(this.origin);
    this.origin.add(shift);
    for (const c of this.chunks.values()) rebaseChunk(c, shift);
    this.flybyAt.sub(shift);
  }

  // --- autopilot guns ----------------------------------------------------------------------

  /** In fields, now and then, a burst at a rock ahead and off to the side. */
  private autopilotGuns(dt: number): void {
    const seg = this.director.segment(Math.floor(this.s / SEGMENT));
    let trigger = false;
    if (seg.kind === 'field') {
      if (this.burst > 0) this.burst -= dt;
      else {
        this.pause -= dt;
        if (this.pause <= 0) {
          this.target = this.pickTarget();
          if (this.target) this.burst = 0.6 + Math.random() * 1.2;
          this.pause = 1 + Math.random() * 2.5;
        }
      }
      if (this.target && !this.inCone(this.target)) this.target = null;
      trigger = this.burst > 0 && this.target !== null;
    } else this.target = null;

    for (const side of stepWeapon(this.weapon, trigger, dt)) {
      if (!this.target) break;
      const mount = GUN_MOUNTS[side]!;
      const muzzle = new THREE.Vector3(mount[0], mount[1], mount[2]).applyQuaternion(this.quat).add(this.pos);
      // Straight at the rock: the autopilot leads its shots, unlike a pilot firing from the hip.
      const dir = new THREE.Vector3(...this.target.position).sub(muzzle).normalize();
      this.bolts.push({ x: muzzle.x, y: muzzle.y, z: muzzle.z, vx: dir.x * WEAPON.boltSpeed, vy: dir.y * WEAPON.boltSpeed, vz: dir.z * WEAPON.boltSpeed, life: WEAPON.boltLife });
      this.fx.muzzle(muzzle.sub(this.origin));
      this.sounds()?.laser(side === 0 ? -0.35 : 0.35);
      this.lastShot = this.time;
    }

    const hits = stepBolts(this.bolts, dt, (ax, ay, az, bx, by, bz) => {
      let best: { t: number; target: Target | null } | null = null;
      const half = Math.hypot(bx - ax, by - ay, bz - az) / 2 + WEAPON.hitRadius;
      for (const c of this.grid.query((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, half, this.scratch)) {
        const t = segmentSphere(ax, ay, az, bx, by, bz, c.position[0], c.position[1], c.position[2], c.radius + WEAPON.hitRadius);
        if (t !== null && (!best || t < best.t)) best = { t, target: c };
      }
      return best;
    });
    for (const hit of hits) {
      const at = new THREE.Vector3(hit.x, hit.y, hit.z).sub(this.origin);
      this.fx.sparks(at, new THREE.Vector3(-hit.dirX, -hit.dirY, -hit.dirZ), 10, ROCK_SPARK);
      this.sounds()?.hit(0.5);
      const target = hit.target;
      if (!target) continue;
      const taken = (this.damage.get(target) ?? 0) + 1;
      if (taken < targetHp(target)) {
        this.damage.set(target, taken);
        continue;
      }
      this.damage.delete(target);
      this.grid.remove(target);
      this.owner.get(target)?.hide.get(target)?.();
      this.owner.delete(target);
      if (this.target === target) this.target = null;
      this.fx.shatter(new THREE.Vector3(...target.position).sub(this.origin), target.radius / 0.92, ROCK_DEBRIS);
      this.sounds()?.shatter(target.radius / 140);
    }
    // The fx draw in scene coordinates.
    this.fx.setBolts(this.bolts.map((b) => ({ ...b, x: b.x - this.origin.x, y: b.y - this.origin.y, z: b.z - this.origin.z })));
  }

  private inCone(target: Target): boolean {
    const to = new THREE.Vector3(...target.position).sub(this.pos);
    const d = to.length();
    return d > 150 && d < 1100 && to.normalize().dot(this.fwd) > Math.cos(0.45);
  }

  private pickTarget(): Target | null {
    const probe = this.pos.clone().addScaledVector(this.fwd, 650);
    const options = this.grid.query(probe.x, probe.y, probe.z, 600, []).filter((t) => t.radius < 80 && Number.isFinite(targetHp(t)) && this.inCone(t));
    if (options.length === 0) return null;
    options.sort((a, b) => distance(a.position, [this.pos.x, this.pos.y, this.pos.z]) - distance(b.position, [this.pos.x, this.pos.y, this.pos.z]));
    return options[Math.floor(Math.random() * Math.min(4, options.length))]!;
  }

  // --- cameras -------------------------------------------------------------------------------

  private setMode(mode: CameraMode): void {
    this.mode = mode;
    if (mode === 'flyby') this.placeFlyby();
    if (mode === 'orbit') this.orbitAngle = Math.random() * Math.PI * 2;
    this.placeCamera(0, true);
  }

  /** A spot ahead on the path and off to one side, for the ship to sweep past. */
  private placeFlyby(): void {
    const path = this.director.path;
    const f = path.frame(this.s + Math.max(250, this.speed * 1.6));
    const side = Math.random() < 0.5 ? -1 : 1;
    this.flybyAt.set(
      f.position[0] + f.right[0] * 28 * side + f.up[0] * 9 - this.origin.x,
      f.position[1] + f.right[1] * 28 * side + f.up[1] * 9 - this.origin.y,
      f.position[2] + f.right[2] * 28 * side + f.up[2] * 9 - this.origin.z,
    );
  }

  private placeCamera(dt: number, snap: boolean): void {
    this.modeTimer -= dt;
    if (this.modeTimer <= 0) {
      // The timer first: setMode places the camera through here again.
      this.modeTimer = 18 + Math.random() * 14;
      this.modeIndex = (this.modeIndex + 1) % CAMERA_ORDER.length;
      this.setMode(CAMERA_ORDER[this.modeIndex]!);
      return;
    }
    const cam = this.camera;
    const shipAt = this.pos.clone().sub(this.origin);
    const boost = this.boostLevel();
    let fov = 66;
    this.ship.root.visible = this.mode !== 'cockpit';
    switch (this.mode) {
      case 'chase':
      case 'wide': {
        const offset = this.mode === 'chase' ? new THREE.Vector3(0, 7.5, 34 + boost * 10) : new THREE.Vector3(14, 30, 150);
        this.camQuat.slerp(this.quat, snap ? 1 : approach(this.mode === 'chase' ? 3 : 1.2, dt));
        cam.position.copy(shipAt).add(offset.applyQuaternion(this.camQuat));
        cam.quaternion.copy(this.camQuat);
        if (this.mode === 'wide') {
          cam.up.set(0, 1, 0);
          cam.lookAt(shipAt.clone().addScaledVector(this.fwd, 60));
        }
        fov = this.mode === 'chase' ? 68 + boost * 14 : 55;
        break;
      }
      case 'orbit': {
        this.orbitAngle += dt * 0.18;
        const local = new THREE.Vector3(Math.sin(this.orbitAngle) * 48, 12 + Math.sin(this.orbitAngle * 0.6) * 8, Math.cos(this.orbitAngle) * 48).applyQuaternion(this.quat);
        cam.position.copy(shipAt).add(local);
        cam.up.set(0, 1, 0);
        cam.lookAt(shipAt);
        fov = 60;
        break;
      }
      case 'flyby': {
        // Once the ship is well past, find the next spot ahead.
        const behind = shipAt.clone().sub(this.flybyAt).dot(this.fwd);
        if (behind > 260) this.placeFlyby();
        cam.position.copy(this.flybyAt);
        cam.up.set(0, 1, 0);
        cam.lookAt(shipAt);
        fov = 50;
        break;
      }
      case 'cockpit': {
        cam.position.copy(shipAt).add(new THREE.Vector3(0, 1.6, -8).applyQuaternion(this.quat));
        cam.quaternion.copy(this.quat);
        fov = 78 + boost * 10;
        break;
      }
    }
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = snap ? fov : cam.fov + (fov - cam.fov) * approach(3, dt);
      cam.updateProjectionMatrix();
    }
  }

  // --- visuals and info ------------------------------------------------------------------------

  private boostLevel(): number {
    return THREE.MathUtils.clamp((this.speed - 520) / 500, 0, 1);
  }

  private updateVisuals(dt: number): void {
    const shipAt = this.pos.clone().sub(this.origin);
    this.ship.root.position.copy(shipAt);
    this.ship.root.quaternion.copy(this.quat);
    this.ship.update(this.time, 1, this.boostLevel(), 0);
    this.stars.position.copy(this.camera.position);
    this.dust.update(this.camera, this.velocity, WHITE);
    for (const [i, c] of this.chunks) {
      for (const u of c.updaters) u(dt, this.time, this.camera);
      if (c.stars.length > 0) {
        const presence = starPresence(i, this.s);
        for (const star of c.stars) star.setFade(presence);
      }
    }
    this.fx.update(dt, this.time);
    // The key light comes from the story's star, in its colour; the fill from behind the camera.
    const seg = this.director.segment(Math.floor(this.s / SEGMENT));
    const light = new THREE.Vector3(...seg.light).sub(this.pos).normalize();
    this.key.position.copy(shipAt).addScaledVector(light, 1000);
    const key = this.keyOf(seg.lightStar);
    const ease = approach(0.4, Number.isFinite(dt) ? Math.max(0, dt) : 0);
    this.key.color.lerp(key.color, ease);
    this.key.intensity += (key.intensity - this.key.intensity) * ease;
    this.key.target.position.copy(shipAt);
    this.fill.position.copy(this.camera.position);
    this.fill.target.position.copy(shipAt);

    // Fog inside nebulae.
    const neb = this.nebulaAt();
    if (neb.colors && neb.density > 0) {
      this.fog.color.set(neb.colors[1]).multiplyScalar(0.12);
      this.fog.density = 0.00022 * neb.density;
    } else this.fog.density = 0;
  }

  private keyOf(star: Star | null): { color: THREE.Color; intensity: number } {
    if (!star) return DEFAULT_KEY;
    let key = this.keys.get(star);
    if (!key) {
      const look = starLook(star);
      key = { color: new THREE.Color().setRGB(...look.light), intensity: look.lightIntensity };
      this.keys.set(star, key);
    }
    return key;
  }

  private nebulaAt(): { density: number; colors: [number, number] | null } {
    let best = 0;
    let colors: [number, number] | null = null;
    const p: [number, number, number] = [this.pos.x, this.pos.y, this.pos.z];
    for (const c of this.chunks.values())
      for (const n of c.nebulae) {
        const k = THREE.MathUtils.clamp((n.radius * 0.9 - distance(p, n.center)) / (n.radius * 0.6), 0, 1);
        if (k > best) {
          best = k;
          colors = n.colors;
        }
      }
    return { density: best, colors };
  }

  private frameInfo(): FlightFrame {
    let star: FlightFrame['star'] = null;
    let nearest = Infinity;
    for (const [i, c] of this.chunks) {
      // A star still fading in, or already fading out, does not dim the view yet.
      if (c.stars.length === 0 || starPresence(i, this.s) < 0.3) continue;
      for (const s of c.stars) {
        const d = s.position.distanceTo(this.camera.position);
        if (d < nearest) {
          nearest = d;
          star = s;
        }
      }
    }
    const neb = this.nebulaAt();
    return { throttle: 1, boost: this.boostLevel(), star, nebula: neb.density, nebulaColors: neb.colors };
  }

  /** The place name fades in as each new stretch begins. */
  private announce(seg: Segment): void {
    this.segmentShown = seg.index;
    const planet = seg.things.find((x) => x.type === 'planet');
    const station = seg.things.find((x) => x.type === 'station');
    const star = seg.things.find((x) => x.type === 'star');
    const text =
      seg.kind === 'field' ? t('regionField', { name: seg.name })
      : seg.kind === 'nebula' ? t('regionNebula', { name: seg.name })
      : seg.kind === 'star' ? t('regionStar', { name: seg.name })
      : seg.kind === 'planet' && planet?.type === 'planet' ? t('regionPlanet', { name: planet.planet.name })
      : seg.kind === 'ruins' ? (station ? t('regionStation', { name: seg.name }) : t('regionWreck', { name: seg.name }))
      : t('regionDeep');
    // A star's line under its name: its class, as a catalogue would give it.
    const facts = seg.kind === 'star' && star?.type === 'star' ? starFacts(star.star) : null;
    this.caption.replaceChildren(text, ...(facts ? [h('span', { class: 'inf-caption-facts' }, facts)] : []));
    this.caption.classList.remove('show');
    void this.caption.offsetWidth;
    this.caption.classList.add('show');
  }
}

const WHITE = new THREE.Color(1, 1, 1);
/** The key light before the first star: a warm white from somewhere off ahead. */
const DEFAULT_KEY = { color: new THREE.Color(0xfff0dc), intensity: 2.6 };
/** How long the pointer may rest before the button and cursor fade out. */
const IDLE_MS = 2500;
const ICON_CAMERA = '<path d="M4 8h3.5L9 5.5h6L16.5 8H20v11H4z"/><circle cx="12" cy="13.5" r="3.2"/>';
const ICON_BACK = '<path d="M14.5 5.5 8 12l6.5 6.5"/>';
const ICON_MUSIC = '<path d="M9 17.5V6l10-2v11.5"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>';
const ICON_STRIKE = '<path d="M3.5 3.5l17 17"/>';
const ROCK_SPARK = new THREE.Color(2.4, 1.3, 0.6);
const ROCK_DEBRIS = new THREE.Color(0.55, 0.5, 0.45);

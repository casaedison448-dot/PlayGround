import * as THREE from './vendor/three.module.js';
import { ISLANDS, OUTER_ISLANDS, RAFT_COST, TUNING, RECIPES, ITEM_LABELS } from './config.js';
import { World } from './world.js';
import { AudioEngine } from './audio.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const isCoarse = window.matchMedia('(pointer: coarse)').matches;
const FOOD_KEYS = ['berries', 'coconut', 'rawFish', 'cookedFish', 'rawMeat', 'cookedMeat'];
const ITEM_ORDER = ['wood', 'stone', 'rope', 'cloth', 'berries', 'coconut', 'rawFish', 'cookedFish', 'rawMeat', 'cookedMeat', 'flare'];
const ITEM_ICONS = {
  wood: '🪵', stone: '🪨', rope: '🧵', cloth: '🧶', berries: '🫐', coconut: '🥥',
  rawFish: '🐟', cookedFish: '🍣', rawMeat: '🥩', cookedMeat: '🍖', flare: '🔥',
};
const EAT_PRIORITY = [
  ['cookedMeat', 46, 0, 8], ['cookedFish', 36, 2, 5], ['coconut', 18, 15, 0],
  ['berries', 12, 2, 0], ['rawFish', 17, 1, -6], ['rawMeat', 24, 0, -8],
];
const SHORT_NAMES = {
  palms: 'Palmeras', rocks: 'Rocosa', mist: 'Niebla', skull: 'Calavera', home: 'Inicio',
};

const formatClock = hours => {
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const formatDuration = seconds => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

class Game {
  constructor() {
    this.canvas = $('scene');
    this.lowQuality = isCoarse || (navigator.hardwareConcurrency || 8) <= 4;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: !this.lowQuality,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.lowQuality ? 1.5 : 1.9));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = !this.lowQuality;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.07, 2300);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.world = new World(this.scene, this.renderer, { lowQuality: this.lowQuality });
    this.audio = new AudioEngine();

    this.el = {};
    this.cacheElements();
    this.initState();
    this.buildViewModel();
    this.buildFishingGear();
    this.bindEvents();
    this.resize();

    this.lastFrame = performance.now();
    this.elapsed = 0;
    this.menuAngle = 0.75;
    this.updateMenuCamera(0);
    this.updateHud(true);

    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);

    const boot = $('boot');
    setTimeout(() => {
      boot.classList.add('done');
      setTimeout(() => boot.classList.add('hidden'), 900);
    }, 260);
  }

  cacheElements() {
    const id = name => $(name);
    this.el = {
      hud: id('hud'), startScreen: id('startScreen'), helpModal: id('helpModal'),
      craftModal: id('craftModal'), pauseScreen: id('pauseScreen'), deathScreen: id('deathScreen'),
      victoryScreen: id('victoryScreen'), touch: id('touch'), boot: id('boot'),
      prompt: id('prompt'), promptText: id('promptText'), crosshair: id('crosshair'),
      toasts: id('toasts'), banner: id('banner'), clock: id('clock'), weather: id('weather'),
      questText: id('questText'), questExtra: id('questExtra'),
      invWood: id('invWood'), invStone: id('invStone'), invRope: id('invRope'),
      invCloth: id('invCloth'), invFood: id('invFood'), invFlare: id('invFlare'),
      stormTint: id('stormTint'), waterTint: id('waterTint'), damageTint: id('damageTint'),
      flashTint: id('flashTint'), fishingUi: id('fishingUi'), fishingLabel: id('fishingLabel'),
      fishingFill: id('fishingFill'), sailInfo: id('sailInfo'), sailSpeed: id('sailSpeed'),
      minimap: id('minimap'), respawnCount: id('respawnCount'), deathText: id('deathText'),
      craftInventory: id('craftInventory'), recipeList: id('recipeList'),
      victoryStats: id('victoryStats'), tInteract: id('tInteract'),
      stick: id('stick'), stickKnob: id('stickKnob'), hint: id('hint'),
    };
    this.el.vitals = {};
    document.querySelectorAll('.vital').forEach(node => {
      this.el.vitals[node.dataset.vital] = {
        fill: node.querySelector('.vbar i'), val: node.querySelector('.vval'),
      };
    });
    this.mapCtx = this.el.minimap.getContext('2d');
  }

  initState() {
    const home = this.world.islands[0];
    const spawn = home.spawnPos.clone();
    spawn.y = this.world.heightAt(spawn.x, spawn.z);
    const look = new THREE.Vector3().subVectors(home.shelterPos, spawn).setY(0).normalize();
    this.player = {
      pos: spawn, vy: 0, jumping: false, swimming: false, onGround: true,
      yaw: Math.atan2(-look.x, -look.z), pitch: -0.045,
      health: 100, hunger: 100, thirst: 100, warmth: 100, stamina: 100,
      onRaft: false, inShelter: false, nearFire: false, moving: false, sprinting: false,
      bob: 0, bobPhase: 0, footstepTimer: 0,
    };
    this.inventory = {
      wood: 0, stone: 0, rope: 0, cloth: 0, berries: 0, coconut: 0,
      rawFish: 0, cookedFish: 0, rawMeat: 0, cookedMeat: 0, flare: 0,
    };
    this.tools = { axe: false, spear: false, rod: false, torch: false };
    this.inventory.flare = 0;
    this.islandFlares = new Set();
    this.visited = new Set(['home']);
    this.shelterNotified = new Set();
    this.lastShelter = 'home';
    this.started = false;
    this.paused = false;
    this.dead = false;
    this.victory = false;
    this.modalOpen = false;
    this.helpReturn = 'game';
    this.craftOpen = false;
    this.timeOfDay = TUNING.startHour;
    this.weather = { phase: 'clear', timer: 74, storm: 0, lightning: 5, label: 'Despejado' };
    this.lastStormAudio = 0;
    this.flash = 0;
    this.damageFlash = 0;
    this.shake = 0;
    this.raftSpeed = 0;
    this.fishing = { state: 'idle', timer: 0, duration: 0, startX: 0, startZ: 0, spot: null, bites: 0 };
    this.aim = null;
    this.currentAction = { type: 'none', rec: null, short: 'USAR' };
    this.landingCandidate = null;
    this.landingCheck = 0;
    this.swing = 0;
    this.respawnTimer = 0;
    this.victoryTime = 0;
    this.runStart = 0;
    this.hudTimer = 0;
    this.mapTimer = 0;
    this.tutorial = { next: 0, stage: 0 };
    this.warned = { hunger: -99, thirst: -99, warmth: -99 };
    this.stats = { fish: 0, boars: 0, storms: 0, distance: 0, deaths: 0, islands: 1 };
    this.keys = new Set();
    this.touchMove = { x: 0, y: 0 };
    this.jumpQueued = false;
    this.lookPointer = null;
    this.joyPointer = null;
    this.lastPromptKey = '';
    this.lastPromptText = '';
    this.lastMapDraw = 0;
    this.setFishingVisible(false);
  }
  buildViewModel() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xc98d62, roughness: 1 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x7c5734, roughness: 1 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x8b8d84, roughness: 0.9, flatShading: true });
    const rope = new THREE.MeshStandardMaterial({ color: 0xb7a06c, roughness: 1 });
    this.vm = new THREE.Group();
    this.camera.add(this.vm);

    const fist = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.11, 0.52, 7), skin);
    arm.position.set(0, -0.13, 0.14);
    arm.rotation.x = 0.55;
    fist.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 7), skin);
    hand.scale.set(1, 0.9, 1.25);
    hand.position.set(0, 0.1, -0.1);
    fist.add(hand);

    const axe = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.042, 1.05, 6), wood);
    handle.rotation.z = 0.36;
    handle.position.set(0, 0.05, 0);
    axe.add(handle);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.09), stone);
    head.position.set(-0.18, 0.5, 0);
    head.rotation.z = 0.2;
    axe.add(head);
    const binding = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.13, 6), rope);
    binding.rotation.z = 0.36;
    binding.position.set(-0.12, 0.4, 0);
    axe.add(binding);

    const spear = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.032, 1.85, 6), wood);
    shaft.rotation.x = Math.PI / 2 - 0.42;
    shaft.position.set(0, 0.08, -0.55);
    spear.add(shaft);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.34, 5), stone);
    tip.rotation.x = -Math.PI / 2 - 0.42;
    tip.position.set(0, 0.43, -1.42);
    spear.add(tip);
    const lash = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.11, 6), rope);
    lash.rotation.x = Math.PI / 2 - 0.42;
    lash.position.set(0, 0.38, -1.25);
    spear.add(lash);

    const rod = new THREE.Group();
    const rodShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.026, 1.65, 5), wood);
    rodShaft.rotation.x = -1.06;
    rodShaft.position.set(0, 0.46, -0.56);
    rod.add(rodShaft);
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.06, 8), stone);
    reel.rotation.z = Math.PI / 2;
    reel.position.set(0, 0.12, -0.22);
    rod.add(reel);

    const torch = new THREE.Group();
    const torchHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.95, 6), wood);
    torchHandle.rotation.z = 0.28;
    torch.add(torchHandle);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.11, 0.36, 7),
      new THREE.MeshBasicMaterial({ color: 0xffc24a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    flame.position.set(-0.13, 0.62, 0);
    torch.add(flame);
    const torchLight = new THREE.PointLight(0xffa24a, 0, 14, 1.8);
    torchLight.position.set(-0.13, 0.68, 0);
    torch.add(torchLight);
    this.torchLight = torchLight;

    const make = (group, x, y, z, rx, ry, rz, scale = 1) => {
      group.position.set(x, y, z);
      group.rotation.set(rx, ry, rz);
      group.scale.setScalar(scale);
      group.visible = false;
      group.userData.basePos = group.position.clone();
      group.userData.baseRot = group.rotation.clone();
      this.vm.add(group);
      return group;
    };
    this.vmTools = {
      fist: make(fist, 0.45, -0.44, -0.72, -0.18, 0.12, -0.05, 0.52),
      axe: make(axe, 0.45, -0.46, -0.78, -0.1, 0.08, -0.2, 0.68),
      spear: make(spear, 0.38, -0.42, -0.8, -0.04, 0.06, -0.1, 0.66),
      rod: make(rod, 0.36, -0.4, -0.72, 0.1, 0.05, -0.12, 0.72),
      torch: make(torch, 0.42, -0.44, -0.72, -0.24, 0.1, -0.05, 0.62),
    };
    this.vm.visible = false;
  }

  buildFishingGear() {
    this.bobber = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xff5a45, roughness: 0.5, emissive: 0x431008, emissiveIntensity: 0.5 }),
    );
    this.bobber.visible = false;
    this.scene.add(this.bobber);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.rodLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf3e8c8, transparent: true, opacity: 0.7 }));
    this.rodLine.frustumCulled = false;
    this.rodLine.visible = false;
    this.scene.add(this.rodLine);
  }

  bindEvents() {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.keys.clear(); });

    $('playBtn').addEventListener('click', () => this.startGame());
    $('helpBtn').addEventListener('click', () => this.openHelp('start'));
    $('helpClose').addEventListener('click', () => this.closeHelp());
    $('helpPlay').addEventListener('click', () => this.closeHelp());
    $('craftClose').addEventListener('click', () => this.closeCraft());
    $('recipeList').addEventListener('click', event => {
      const btn = event.target.closest('[data-recipe]');
      if (!btn || btn.disabled) return;
      this.craft(btn.dataset.recipe);
    });
    $('resumeBtn').addEventListener('click', () => this.togglePause(false));
    $('pauseHelpBtn').addEventListener('click', () => this.openHelp('pause'));
    $('restartBtn').addEventListener('click', () => window.location.reload());
    $('muteBtn').addEventListener('click', () => {
      this.audio.setMuted(!this.audio.muted);
      $('muteBtn').textContent = `SONIDO: ${this.audio.muted ? 'NO' : 'SÍ'}`;
      this.audio.click();
    });
    $('respawnBtn').addEventListener('click', () => this.respawn());
    $('againBtn').addEventListener('click', () => window.location.reload());

    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    this.canvas.addEventListener('pointerdown', e => this.onCanvasPointerDown(e));
    window.addEventListener('pointermove', e => this.onPointerMove(e));
    window.addEventListener('pointerup', e => this.onPointerUp(e));
    window.addEventListener('pointercancel', e => this.onPointerUp(e));
    window.addEventListener('mousemove', e => {
      if (document.pointerLockElement === this.canvas && this.isActive()) {
        this.player.yaw -= e.movementX * 0.0022;
        this.player.pitch = clamp(this.player.pitch - e.movementY * 0.0022, -1.35, 1.35);
      }
    });
    document.addEventListener('keydown', e => this.onKeyDown(e));
    document.addEventListener('keyup', e => this.keys.delete(e.code));
    document.addEventListener('pointerlockchange', () => {
      this.el.hint.classList.toggle('hidden', document.pointerLockElement === this.canvas);
    });

    this.el.stick.addEventListener('pointerdown', e => this.onJoyDown(e));
    this.el.stick.addEventListener('pointermove', e => this.onJoyMove(e));
    this.el.stick.addEventListener('pointerup', e => this.onJoyUp(e));
    this.el.stick.addEventListener('pointercancel', e => this.onJoyUp(e));
    document.querySelectorAll('.tbtn').forEach(btn => {
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.isActive()) return;
        const action = btn.dataset.action;
        if (action === 'interact') this.interact();
        else if (action === 'attack') this.attack();
        else if (action === 'fish') this.fishAction();
        else if (action === 'eat') this.eat();
        else if (action === 'craft') this.openCraft();
      });
    });
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.lowQuality ? 1.5 : 1.9));
  }

  requestLock() {
    if (isCoarse) return;
    try {
      const result = this.canvas.requestPointerLock();
      if (result && result.catch) result.catch(() => {});
    } catch (_) { /* pointer lock can be unavailable in embedded browsers */ }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isActive() {
    return this.started && !this.paused && !this.dead && !this.victory && !this.modalOpen;
  }

  startGame() {
    if (this.started) return;
    this.started = true;
    this.modalOpen = false;
    this.runStart = this.elapsed;
    this.el.startScreen.classList.add('hidden');
    this.el.helpModal.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    this.el.hint.classList.toggle('hidden', isCoarse);
    if (isCoarse) this.el.touch.classList.remove('hidden');
    this.audio.init();
    this.requestLock();
    this.updateCamera(1 / 60);
    this.updateHud(true);
    this.banner('ISLA INICIO');
    this.toast('Recoge ramas y madera. Pulsa C para fabricar herramientas.', 'good', 5200);
    this.audio.click();
  }

  togglePause(force) {
    if (!this.started || this.dead || this.victory) return;
    if (this.modalOpen) return;
    const next = force !== undefined ? force : !this.paused;
    if (next === this.paused) return;
    this.paused = next;
    this.el.pauseScreen.classList.toggle('hidden', !next);
    this.hidePrompt();
    if (next) {
      this.exitLock();
      this.audio.click();
    } else {
      this.requestLock();
      this.lastFrame = performance.now();
      this.audio.click();
    }
  }

  openHelp(from) {
    if (this.victory || this.dead) return;
    this.helpReturn = from;
    if (from === 'pause') this.el.pauseScreen.classList.add('hidden');
    this.modalOpen = true;
    this.el.helpModal.classList.remove('hidden');
    this.exitLock();
  }

  closeHelp() {
    this.el.helpModal.classList.add('hidden');
    if (this.helpReturn === 'pause' && this.paused) {
      this.el.pauseScreen.classList.remove('hidden');
      this.modalOpen = false;
      return;
    }
    this.modalOpen = false;
    if (this.started && !this.paused) this.requestLock();
  }

  openCraft() {
    if (!this.started || !this.isActive()) return;
    this.craftOpen = true;
    this.modalOpen = true;
    this.el.craftModal.classList.remove('hidden');
    this.exitLock();
    this.renderCraft();
    this.audio.click();
  }

  closeCraft() {
    this.el.craftModal.classList.add('hidden');
    this.craftOpen = false;
    this.modalOpen = false;
    if (this.started && !this.paused) this.requestLock();
    this.audio.click();
  }

  onKeyDown(e) {
    if (e.code === 'Escape') {
      if (!this.el.helpModal.classList.contains('hidden')) { this.closeHelp(); return; }
      if (!this.el.craftModal.classList.contains('hidden')) { this.closeCraft(); return; }
      if (this.started && !this.dead && !this.victory) this.togglePause();
      return;
    }
    if (!this.started) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    }
    if (!this.isActive() || e.repeat) return;
    if (e.code === 'KeyE') { e.preventDefault(); this.interact(); }
    else if (e.code === 'KeyC') { e.preventDefault(); this.openCraft(); }
    else if (e.code === 'KeyF') { e.preventDefault(); this.fishAction(); }
    else if (e.code === 'KeyQ') { e.preventDefault(); this.eat(); }
    else if (e.code === 'Space') { e.preventDefault(); this.jumpQueued = true; }
  }

  onCanvasPointerDown(e) {
    if (e.pointerType === 'touch' || isCoarse) {
      if (!this.isActive()) return;
      if (!this.lookPointer) {
        this.lookPointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
        try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
      }
      return;
    }
    if (!this.isActive()) return;
    if (document.pointerLockElement !== this.canvas) {
      this.requestLock();
      return;
    }
    if (e.button === 0) this.attack();
  }

  onPointerMove(e) {
    if (this.lookPointer && e.pointerId === this.lookPointer.id && this.isActive()) {
      const dx = e.clientX - this.lookPointer.x;
      const dy = e.clientY - this.lookPointer.y;
      this.lookPointer.x = e.clientX;
      this.lookPointer.y = e.clientY;
      this.player.yaw -= dx * 0.0055;
      this.player.pitch = clamp(this.player.pitch - dy * 0.0055, -1.35, 1.35);
      return;
    }
    if (this.joyPointer && e.pointerId === this.joyPointer.id) this.updateJoy(e);
  }

  onPointerUp(e) {
    if (this.lookPointer && e.pointerId === this.lookPointer.id) this.lookPointer = null;
    if (this.joyPointer && e.pointerId === this.joyPointer.id) this.onJoyUp(e);
  }
  onJoyDown(e) {
    e.preventDefault();
    e.stopPropagation();
    if (this.joyPointer) return;
    this.joyPointer = { id: e.pointerId };
    try { this.el.stick.setPointerCapture(e.pointerId); } catch (_) {}
    this.updateJoy(e);
  }

  onJoyMove(e) {
    if (!this.joyPointer || e.pointerId !== this.joyPointer.id) return;
    e.preventDefault();
    this.updateJoy(e);
  }

  onJoyUp(e) {
    if (!this.joyPointer || e.pointerId !== this.joyPointer.id) return;
    this.joyPointer = null;
    this.touchMove.x = 0;
    this.touchMove.y = 0;
    this.el.stickKnob.style.transform = 'translate(0px, 0px)';
  }

  updateJoy(e) {
    const rect = this.el.stick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = rect.width * 0.38;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > radius) { dx = (dx / len) * radius; dy = (dy / len) * radius; }
    this.el.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.touchMove.x = clamp(dx / radius, -1, 1);
    this.touchMove.y = clamp(-dy / radius, -1, 1);
  }

  toast(text, type = '', duration = 3300) {
    const node = document.createElement('div');
    node.className = `toast ${type}`.trim();
    node.textContent = text;
    this.el.toasts.appendChild(node);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
    setTimeout(() => {
      node.classList.add('out');
      setTimeout(() => node.remove(), 380);
    }, duration);
  }

  banner(text) {
    const b = this.el.banner;
    b.textContent = text;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  loop(now) {
    requestAnimationFrame(this.loop);
    const raw = Math.min(0.05, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.elapsed += raw;

    if (!this.started) {
      this.updateMenuCamera(raw);
    } else {
      const active = this.isActive();
      if (active) this.updateGame(raw);
      else {
        if (this.dead) this.updateDeath(raw);
        else if (this.victory) this.updateVictory(raw);
        else this.updateCamera(raw);
      }
      this.updateHud(raw);
    }

    this.updateGlobalFx(raw);
    this.updateWeatherAudio();
    this.world.update(raw, this.elapsed, this.camera, {
      time: this.timeOfDay,
      storm: this.weather.storm,
      flash: this.flash,
      playerPos: this.player.pos,
    });
    this.renderer.render(this.scene, this.camera);
  }

  updateMenuCamera(dt) {
    this.menuAngle += dt * 0.028;
    const a = this.menuAngle;
    this.camera.position.set(Math.cos(a) * 118, 36 + Math.sin(this.elapsed * 0.2) * 2.5, Math.sin(a) * 118);
    this.camera.lookAt(-22, 3.5, 0);
    if (this.camera.fov !== 64) {
      this.camera.fov = 64;
      this.camera.updateProjectionMatrix();
    }
    this.el.hint.classList.add('hidden');
  }

  updateGlobalFx(dt) {
    this.flash = Math.max(0, this.flash - dt * 2.6);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.9);
    this.shake = Math.max(0, this.shake - dt * 2.6);
    {
      const storm = this.weather.storm;
      this.el.stormTint.style.opacity = (storm * 0.78).toFixed(3);
      this.el.waterTint.style.opacity = (this.player.swimming ? 0.62 : 0).toFixed(3);
      this.el.damageTint.style.opacity = Math.min(1, this.damageFlash * 1.25).toFixed(3);
      this.el.flashTint.style.opacity = (this.flash * 0.75).toFixed(3);
    }
  }

  updateWeatherAudio() {
    if (!this.audio.ready) return;
    if (Math.abs(this.weather.storm - this.lastStormAudio) > 0.07) {
      this.lastStormAudio = this.weather.storm;
      this.audio.setStorm(this.weather.storm);
    }
  }

  updateGame(dt) {
    this.timeOfDay = (this.timeOfDay + dt * 24 / TUNING.dayLength) % 24;
    this.updateWeather(dt);
    this.updateTutorial(dt);

    for (const rec of this.world.interactables) {
      if (rec.cooldown > 0) rec.cooldown = Math.max(0, rec.cooldown - dt);
    }

    const beforeX = this.player.pos.x, beforeZ = this.player.pos.z;
    if (this.player.onRaft) this.updateRaft(dt);
    else this.updatePlayer(dt);
    this.stats.distance += Math.hypot(this.player.pos.x - beforeX, this.player.pos.z - beforeZ);

    this.updateShelterState();
    this.updateAnimals(dt);
    this.updateSurvival(dt);
    this.updateAim();
    this.updateFishing(dt);
    this.updatePrompt();
    this.updateIslandDiscovery();
    this.updateViewModel(dt);
    this.updateCamera(dt);
    this.updateFishingVisual();
  }

  updateWeather(dt) {
    const w = this.weather;
    if (w.phase === 'clear') {
      w.timer -= dt;
      w.storm = damp(w.storm, 0, 1.6, dt);
      if (w.timer <= 0) {
        w.phase = 'warning';
        w.timer = 10;
        this.banner('TORMENTA EN CAMINO');
        this.toast('El viento cambia… se acerca una tormenta. Busca refugio.', 'bad', 5000);
      }
    } else if (w.phase === 'warning') {
      w.timer -= dt;
      w.storm = damp(w.storm, 0.13, 0.5, dt);
      if (w.timer <= 0) {
        w.phase = 'storm';
        w.timer = 32 + Math.random() * 10;
        w.lightning = 2.5 + Math.random() * 3;
        this.stats.storms++;
        this.banner('TORMENTA');
        this.toast('La tormenta descarga sobre el archipiélago. Refúgiate bajo techo.', 'bad', 5200);
        if (this.fishing.state !== 'idle') this.cancelFishing('La tormenta espanta a los peces.');
      }
    } else if (w.phase === 'storm') {
      w.timer -= dt;
      w.storm = damp(w.storm, 1, 0.7, dt);
      w.lightning -= dt;
      if (w.lightning <= 0) {
        this.triggerLightning();
        w.lightning = 4 + Math.random() * 7;
      }
      if (w.timer <= 0) {
        w.phase = 'clearing';
        w.timer = 11;
        this.banner('LA TORMENTA AMAINA');
        this.toast('El cielo se abre. Puedes seguir explorando.', 'good');
      }
    } else if (w.phase === 'clearing') {
      w.timer -= dt;
      w.storm = damp(w.storm, 0, 0.3, dt);
      if (w.timer <= 0) {
        w.phase = 'clear';
        w.timer = 105 + Math.random() * 65;
        w.storm = 0;
      }
    }
    const night = this.isNight();
    w.label = w.phase === 'storm' ? 'Tormenta' : w.phase === 'warning' ? 'Viento fuerte'
      : w.phase === 'clearing' ? 'Aclarando' : (night ? 'Noche despejada' : 'Despejado');
  }

  triggerLightning() {
    this.flash = 1;
    this.shake = Math.max(this.shake, 0.6);
    this.audio.thunder();
  }

  updateTutorial(dt) {
    if (this.tutorial.stage >= 3) return;
    this.tutorial.next += dt;
    if (this.tutorial.stage === 0 && this.tutorial.next > 6) {
      this.tutorial.stage = 1;
      this.toast('Golpea palmeras y rocas para obtener madera y piedra.', '', 4300);
    } else if (this.tutorial.stage === 1 && this.tutorial.next > 18) {
      this.tutorial.stage = 2;
      this.toast('Fabrica un hacha (C). La balsa se construye en el astillero, al este del campamento.', '', 5000);
    } else if (this.tutorial.stage === 2 && this.tutorial.next > 36) {
      this.tutorial.stage = 3;
      this.toast('Necesitas 16 madera, 6 cuerda y 2 tela para la balsa.', '', 4600);
    }
  }
  updatePlayer(dt) {
    const p = this.player;
    const keys = this.keys;
    let x = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + this.touchMove.x;
    let z = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) + this.touchMove.y;
    const mag = Math.hypot(x, z);
    if (mag > 1) { x /= mag; z /= mag; }
    p.moving = mag > 0.08;
    const sprintKey = keys.has('ShiftLeft') || keys.has('ShiftRight');
    p.sprinting = p.moving && sprintKey && !p.swimming && p.stamina > 1;

    const terrain = this.world.heightAt(p.pos.x, p.pos.z);
    const swimming = terrain < -0.62;
    const wading = !swimming && terrain < 0.18;
    p.swimming = swimming;

    let speed = swimming ? TUNING.swimSpeed : wading ? 3.1 : (p.sprinting ? TUNING.sprintSpeed : TUNING.walkSpeed);
    if (p.stamina <= 0.5) speed *= 0.66;

    const sinY = Math.sin(p.yaw), cosY = Math.cos(p.yaw);
    const mx = (-sinY) * z + cosY * x;
    const mz = (-cosY) * z + (-sinY) * x;
    const moveLen = Math.hypot(mx, mz);
    if (moveLen > 0.001) {
      p.pos.x += mx * speed * dt;
      p.pos.z += mz * speed * dt;
      p.pos.x = clamp(p.pos.x, -620, 620);
      p.pos.z = clamp(p.pos.z, -620, 620);
      if (!swimming) this.resolveCollisions();
      if (this.fishing.state !== 'idle'
        && Math.hypot(p.pos.x - this.fishing.startX, p.pos.z - this.fishing.startZ) > 0.75) {
        this.cancelFishing('Te has movido y has recogido la caña.');
      }
    }

    const groundNow = this.world.heightAt(p.pos.x, p.pos.z);
    if (p.swimming) {
      p.jumping = false;
      p.vy = 0;
      p.pos.y = damp(p.pos.y, -1.05, 5, dt);
      p.footstepTimer -= dt;
      if (p.footstepTimer <= 0 && moveLen > 0.05) {
        p.footstepTimer = 1.1;
        this.audio.splash();
        this.world.splash(p.pos.x, 0.08, p.pos.z, 0xcdeff5, 7, 1.2);
      }
    } else {
      const floor = Math.max(groundNow, 0.02);
      if (this.jumpQueued && !p.jumping && p.stamina > 4) {
        p.jumping = true;
        p.vy = 5.1;
        p.stamina -= 4;
      }
      if (p.jumping) {
        p.vy -= 17 * dt;
        p.pos.y += p.vy * dt;
        if (p.pos.y <= floor) {
          p.pos.y = floor;
          p.jumping = false;
          p.vy = 0;
          p.onGround = true;
        } else p.onGround = false;
      } else {
        p.pos.y = floor;
        p.onGround = true;
      }
    }
    this.jumpQueued = false;

    if (p.sprinting) p.stamina -= TUNING.staminaDrainSprint * dt;
    else if (p.swimming) p.stamina -= TUNING.staminaDrainSwim * dt;
    else p.stamina += TUNING.staminaRegen * dt * (p.moving ? 0.65 : 1);
    p.stamina = clamp(p.stamina, 0, 100);

    if (p.moving && !p.swimming) {
      const rate = p.sprinting ? 13 : 9.5;
      p.bobPhase += dt * rate;
      p.bob = Math.sin(p.bobPhase) * (p.sprinting ? 0.052 : 0.034);
    } else {
      p.bob = damp(p.bob, 0, 8, dt);
    }
  }

  resolveCollisions() {
    const p = this.player;
    for (const c of this.world.colliders) {
      if (c.r <= 0.02) continue;
      const dx = p.pos.x - c.x;
      const dz = p.pos.z - c.z;
      const min = c.r + 0.42;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        p.pos.x = c.x + (dx / d) * min;
        p.pos.z = c.z + (dz / d) * min;
      }
    }
  }

  updateRaft(dt) {
    const p = this.player;
    const keys = this.keys;
    let throttle = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) + this.touchMove.y;
    let steer = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + this.touchMove.x;
    throttle = clamp(throttle, -1, 1);
    steer = clamp(steer, -1, 1);
    this.raftSpeed = damp(this.raftSpeed, throttle * TUNING.raftSpeed, 2.0, dt);
    if (Math.abs(this.raftSpeed) < 0.06) this.raftSpeed = 0;
    if (Math.abs(steer) > 0.05 && Math.abs(this.raftSpeed) > 0.2) {
      const dir = this.raftSpeed >= 0 ? 1 : -1;
      this.world.raftHeading -= steer * 1.15 * dt * dir;
    }
    const h = this.world.raftHeading;
    let nx = this.world.raftPos.x - Math.sin(h) * this.raftSpeed * dt;
    let nz = this.world.raftPos.z - Math.cos(h) * this.raftSpeed * dt;
    if (this.weather.storm > 0.4) {
      nx += (Math.random() - 0.5) * dt * 0.5;
      nz += (Math.random() - 0.5) * dt * 0.5;
    }
    nx = clamp(nx, -620, 620);
    nz = clamp(nz, -620, 620);
    this.world.setRaftTransform(nx, nz, h, Math.min(1, Math.abs(this.raftSpeed) / TUNING.raftSpeed));
    p.pos.set(nx, 0.32, nz);
    p.swimming = false;
    p.moving = Math.abs(this.raftSpeed) > 0.4;
    p.sprinting = false;
    p.stamina = clamp(p.stamina + TUNING.staminaRegen * 0.8 * dt, 0, 100);
    if (this.fishing.state !== 'idle' && Math.abs(this.raftSpeed) > 0.7) {
      this.cancelFishing('La balsa se mueve demasiado para pescar.');
    }
  }

  updateShelterState() {
    const p = this.player;
    let inShelter = false;
    let nearFire = false;
    for (const s of this.world.shelters) {
      if (Math.hypot(p.pos.x - s.pos.x, p.pos.z - s.pos.z) < s.radius) {
        inShelter = true;
        if (!this.shelterNotified.has(s.islandId)) {
          this.shelterNotified.add(s.islandId);
          if (s.islandId !== 'home') {
            const isl = this.world.islands.find(i => i.id === s.islandId);
            this.toast(`Refugio de ${isl ? isl.name : 'la isla'} alcanzado.`, 'good');
          }
        }
        if (this.lastShelter !== s.islandId) {
          this.lastShelter = s.islandId;
          if (s.islandId !== 'home') this.toast(`Punto de reaparición: ${this.world.islands.find(i => i.id === s.islandId).name}.`, '', 3200);
        }
      }
    }
    for (const fire of this.world.fires) {
      if (Math.hypot(p.pos.x - fire.group.position.x, p.pos.z - fire.group.position.z) < 6.2) nearFire = true;
    }
    p.inShelter = inShelter;
    p.nearFire = nearFire;
  }

  updateSurvival(dt) {
    const p = this.player;
    p.hunger = clamp(p.hunger - TUNING.hungerDrain * dt, 0, 100);
    p.thirst = clamp(p.thirst - TUNING.thirstDrain * dt, 0, 100);

    if (p.nearFire) p.warmth += TUNING.fireWarmthGain * dt;
    else if (p.inShelter) p.warmth += TUNING.shelterWarmthGain * dt;
    else {
      if (this.isNight()) p.warmth -= TUNING.nightWarmthDrain * dt;
      if (this.weather.storm > 0.2) p.warmth -= TUNING.stormWarmthDrain * dt * this.weather.storm;
    }
    p.warmth = clamp(p.warmth, 0, 100);

    if (p.hunger <= 0) p.health -= TUNING.hungerStarveDamage * dt;
    if (p.thirst <= 0) p.health -= TUNING.thirstDamage * dt;
    if (p.warmth <= 0) p.health -= TUNING.coldDamage * dt;
    if (p.swimming && p.stamina <= 0) p.health -= 1.7 * dt;
    if (p.hunger > 45 && p.thirst > 45 && p.warmth > 25 && p.health < 100) {
      p.health += TUNING.healthRegen * dt;
    }
    p.health = clamp(p.health, 0, 100);

    if (p.health <= 0 && !this.dead) this.die();

    if (p.hunger < 20 && this.elapsed - this.warned.hunger > 32) {
      this.warned.hunger = this.elapsed;
      this.toast('Tienes hambre. Come algo con Q o asa pescado en una hoguera.', 'bad');
    }
    if (p.thirst < 20 && this.elapsed - this.warned.thirst > 32) {
      this.warned.thirst = this.elapsed;
      this.toast('Tienes sed. Bebe en un manantial junto a cualquier refugio.', 'bad');
    }
    if (p.warmth < 22 && this.elapsed - this.warned.warmth > 34) {
      this.warned.warmth = this.elapsed;
      this.toast('Estás perdiendo calor. Acércate a una hoguera o refúgiate.', 'bad');
    }
  }

  isNight() {
    return this.timeOfDay < 6.1 || this.timeOfDay > 19.1;
  }
  updateAnimals(dt) {
    const p = this.player;
    const safe = p.onRaft || p.swimming || p.inShelter;
    const night = this.isNight();
    for (const a of this.world.animals) {
      const group = a.group;
      if (!a.alive) {
        a.deathTimer += dt;
        const k = Math.min(1, a.deathTimer / 0.7);
        group.rotation.z = k * Math.PI * 0.5;
        group.position.y = a.pos.y + 0.5 * (1 - k);
        if (a.deathTimer > 5) group.visible = false;
        if (a.deathTimer > 78) this.world.resetAnimal(a);
        continue;
      }
      a.attackCd = Math.max(0, a.attackCd - dt);
      const dx = p.pos.x - a.pos.x;
      const dz = p.pos.z - a.pos.z;
      const dist = Math.hypot(dx, dz);
      const aggro = night ? 16.5 : 11;
      let moving = false;
      let chasing = false;

      if (!safe && dist < aggro && dist > 0.001) {
        chasing = true;
        if (dist > 1.85) {
          const speed = a.speed * (night ? 1.16 : 1);
          const nx = a.pos.x + (dx / dist) * speed * dt;
          const nz = a.pos.z + (dz / dist) * speed * dt;
          const h = this.world.heightAt(nx, nz);
          if (h > 0.2) {
            a.pos.x = nx;
            a.pos.z = nz;
            a.heading = Math.atan2(dx, dz);
            moving = true;
          }
        } else if (a.attackCd <= 0) {
          a.attackCd = 1.55;
          a.lunge = 0.32;
          const dmg = 8 + Math.random() * 4.5;
          this.damagePlayer(dmg);
          this.audio.hit();
          const push = 0.55;
          const nx = p.pos.x + (dx / -dist) * push;
          const nz = p.pos.z + (dz / -dist) * push;
          if (!this.player.swimming && this.world.heightAt(nx, nz) > 0.15) {
            this.player.pos.x = nx;
            this.player.pos.z = nz;
          }
        }
      } else {
        a.wanderTimer -= dt;
        if (a.wanderTimer <= 0 || Math.hypot(a.target.x - a.pos.x, a.target.z - a.pos.z) < 0.8) {
          a.wanderTimer = 3.5 + Math.random() * 5;
          const ang = Math.random() * Math.PI * 2;
          const rad = Math.random() * 10;
          a.target.set(a.home.x + Math.cos(ang) * rad, 0, a.home.z + Math.sin(ang) * rad);
        }
        const tx = a.target.x - a.pos.x;
        const tz = a.target.z - a.pos.z;
        const td = Math.hypot(tx, tz);
        if (td > 0.7) {
          const nx = a.pos.x + (tx / td) * 1.15 * dt;
          const nz = a.pos.z + (tz / td) * 1.15 * dt;
          const h = this.world.heightAt(nx, nz);
          if (h > 0.15) {
            a.pos.x = nx;
            a.pos.z = nz;
            a.heading = Math.atan2(tx, tz);
            moving = true;
          } else a.wanderTimer = 0;
        }
      }

      const hy = this.world.heightAt(a.pos.x, a.pos.z);
      a.pos.y = Math.max(hy, 0.12);
      group.position.x = a.pos.x;
      group.position.z = a.pos.z;
      group.position.y = a.pos.y + (a.lunge > 0 ? Math.sin((1 - a.lunge / 0.32) * Math.PI) * 0.16 : 0);
      group.rotation.y = a.heading;
      group.rotation.z = 0;
      if (a.lunge > 0) a.lunge -= dt;

      const gait = moving ? Math.sin(this.elapsed * (chasing ? 12 : 7) + a.phase) : 0;
      const legs = group.userData.legs;
      if (legs) {
        for (let i = 0; i < legs.length; i++) {
          legs[i].rotation.x = gait * 0.55 * (i % 2 === 0 ? 1 : -1);
        }
      }
      if (group.userData.body) {
        group.userData.body.position.y = 0.95 + Math.abs(gait) * 0.025;
      }
      if (a.hitFlash > 0) {
        a.hitFlash = Math.max(0, a.hitFlash - dt);
        if (group.userData.body) {
          group.userData.body.material.emissive.setHex(0x7a1500);
          group.userData.body.material.emissiveIntensity = a.hitFlash * 3;
        }
      } else if (group.userData.body) {
        group.userData.body.material.emissiveIntensity = 0;
      }
    }
  }

  damagePlayer(amount) {
    if (this.dead || this.victory) return;
    const p = this.player;
    p.health = clamp(p.health - amount, 0, 100);
    this.damageFlash = Math.min(1.2, this.damageFlash + 0.65);
    this.shake = Math.max(this.shake, 0.42);
    this.audio.hurt();
    if (p.health <= 0) this.die();
  }

  die() {
    if (this.dead || this.victory) return;
    this.dead = true;
    this.player.health = 0;
    this.player.onRaft = false;
    this.respawnTimer = 9;
    this.stats.deaths++;
    this.hidePrompt();
    this.cancelFishing();
    this.exitLock();
    this.el.deathScreen.classList.remove('hidden');
    this.el.respawnCount.textContent = '9';
    this.audio.lose();
    const lost = [];
    for (const key of ['wood', 'stone', 'rope', 'cloth', 'berries', 'coconut', 'rawFish', 'cookedFish', 'rawMeat', 'cookedMeat']) {
      const n = Math.ceil(this.inventory[key] * 0.25);
      if (n > 0) {
        this.inventory[key] -= n;
        lost.push(`${n} ${ITEM_LABELS[key]}`);
      }
    }
    this.el.deathText.textContent = lost.length
      ? `Despiertas en el último refugio. La marea se llevó parte de tu equipo: ${lost.slice(0, 3).join(', ')}${lost.length > 3 ? '…' : ''}.`
      : 'Despiertas en el último refugio. Esta vez no has perdido nada.';
    this.updateHud(true);
  }

  updateDeath(dt) {
    this.respawnTimer -= dt;
    const secs = Math.max(0, Math.ceil(this.respawnTimer));
    if (this.el.respawnCount.textContent !== String(secs)) this.el.respawnCount.textContent = String(secs);
    if (this.respawnTimer <= 0) this.respawn();
  }

  respawn() {
    if (!this.dead) return;
    this.dead = false;
    this.el.deathScreen.classList.add('hidden');
    const isl = this.world.islands.find(i => i.id === this.lastShelter) || this.world.islands[0];
    const dir = new THREE.Vector3().subVectors(isl.shelterPos, new THREE.Vector3(isl.x, isl.shelterPos.y, isl.z)).setY(0).normalize();
    const px = isl.shelterPos.x + dir.x * 3.4;
    const pz = isl.shelterPos.z + dir.z * 3.4;
    const py = Math.max(this.world.heightAt(px, pz), 0.05);
    this.player.pos.set(px, py, pz);
    this.player.health = 50;
    this.player.hunger = Math.max(this.player.hunger, 38);
    this.player.thirst = Math.max(this.player.thirst, 38);
    this.player.warmth = Math.max(this.player.warmth, 70);
    this.player.stamina = 60;
    this.player.jumping = false;
    this.player.vy = 0;
    this.player.swimming = false;
    this.player.onRaft = false;
    this.raftSpeed = 0;
    const look = new THREE.Vector3().subVectors(isl.shelterPos, this.player.pos).setY(0).normalize();
    this.player.yaw = Math.atan2(-look.x, -look.z);
    this.player.pitch = -0.05;
    this.el.sailInfo.classList.add('hidden');
    this.toast(`Reapareces en ${isl.name}.`, 'good');
    this.requestLock();
    this.updateHud(true);
  }

  updateVictory(dt) {
    this.victoryTime += dt;
    const t = this.victoryTime;
    const home = this.world.islands[0];
    const desired = new THREE.Vector3(home.x + 22, 9.5, home.z + 64);
    this.camera.position.lerp(desired, 1 - Math.exp(-2.2 * dt));
    const ship = this.world.rescueShip.position;
    const look = new THREE.Vector3(lerp(home.x + 20, ship.x, Math.min(1, t / 4)), 4.5, lerp(home.z + 60, ship.z, Math.min(1, t / 4)));
    this.camera.lookAt(look);
    if (this.camera.fov !== 58) { this.camera.fov = 58; this.camera.updateProjectionMatrix(); }
  }
  updateCamera(dt) {
    const p = this.player;
    if (p.onRaft) {
      const h = this.world.raftHeading;
      const fx = -Math.sin(h), fz = -Math.cos(h);
      const rx = this.world.raftPos.x, rz = this.world.raftPos.z;
      const desired = new THREE.Vector3(rx - fx * 9.2, 5.0, rz - fz * 9.2);
      const ground = this.world.heightAt(desired.x, desired.z);
      if (ground + 2.4 > desired.y) desired.y = ground + 2.4;
      desired.y += Math.sin(this.elapsed * 1.4) * 0.08;
      const k = 1 - Math.exp(-4.5 * dt);
      this.camera.position.lerp(desired, k);
      this.camera.lookAt(rx + fx * 4.5, 1.75, rz + fz * 4.5);
      this.camera.rotation.z += Math.sin(this.elapsed * 1.1) * 0.012 + this.weather.storm * Math.sin(this.elapsed * 2.3) * 0.01;
      if (this.camera.fov !== 63) { this.camera.fov = 63; this.camera.updateProjectionMatrix(); }
      this.applyShake();
      return;
    }
    const eye = 1.67;
    const bob = p.swimming ? Math.sin(this.elapsed * 1.8) * 0.035 : p.bob;
    this.camera.position.set(p.pos.x, p.pos.y + eye + bob, p.pos.z);
    this.camera.rotation.set(p.pitch, p.yaw, p.swimming ? Math.sin(this.elapsed * 0.9) * 0.008 : 0);
    let targetFov = 70;
    if (p.sprinting) targetFov = 76;
    else if (p.swimming) targetFov = 72;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = damp(this.camera.fov, targetFov, 5, dt);
      this.camera.updateProjectionMatrix();
    }
    this.applyShake();
  }

  applyShake() {
    if (this.shake <= 0.001) return;
    const s = this.shake;
    this.camera.position.x += (Math.random() - 0.5) * s * 0.22;
    this.camera.position.y += (Math.random() - 0.5) * s * 0.18;
    this.camera.rotation.z += (Math.random() - 0.5) * s * 0.035;
    this.camera.rotation.x += (Math.random() - 0.5) * s * 0.02;
  }

  updateIslandDiscovery() {
    for (const island of this.world.islands) {
      if (this.visited.has(island.id)) continue;
      if (Math.hypot(this.player.pos.x - island.x, this.player.pos.z - island.z) < island.radius * 1.12) {
        this.visited.add(island.id);
        this.stats.islands = this.visited.size;
        this.toast(`Isla descubierta: ${island.name}. Busca su refugio.`, 'good', 4500);
        this.banner(island.name.toUpperCase());
        this.audio.pickup();
        this.updateHud(true);
      }
    }
  }

  updateAim() {
    if (this.player.onRaft) { this.aim = null; this.el.crosshair.classList.remove('target'); return; }
    const p = this.player;
    const cp = this.camera.position;
    const dir = new THREE.Vector3(
      -Math.sin(p.yaw) * Math.cos(p.pitch),
      Math.sin(p.pitch),
      -Math.cos(p.yaw) * Math.cos(p.pitch),
    );
    let best = null;
    let bestScore = -1;
    const consider = (kind, rec, cx, cy, cz, reach) => {
      const vx = cx - cp.x, vy = cy - cp.y, vz = cz - cp.z;
      const dist = Math.hypot(vx, vy, vz);
      if (dist > reach || dist < 0.05) return;
      const dot = (vx * dir.x + vy * dir.y + vz * dir.z) / dist;
      if (dot < 0.42) return;
      const score = dot - dist * 0.035;
      if (score > bestScore) {
        bestScore = score;
        best = { kind, rec, dist, dot, x: cx, y: cy, z: cz };
      }
    };
    for (const a of this.world.animals) {
      if (!a.alive) continue;
      consider('animal', a, a.pos.x, a.pos.y + 0.85, a.pos.z, 4.3);
    }
    for (const t of this.world.trees) {
      if (!t.alive) continue;
      consider('tree', t, t.pos.x, t.pos.y + 2.2 * t.scale, t.pos.z, 3.8);
    }
    for (const r of this.world.rocks) {
      if (!r.alive) continue;
      consider('rock', r, r.pos.x, r.pos.y + 0.5, r.pos.z, 3.5);
    }
    this.aim = best;
    this.el.crosshair.classList.toggle('target', Boolean(best));
  }

  updatePrompt() {
    if (this.fishing.state !== 'idle') { this.hidePrompt(); return; }
    if (this.player.onRaft) {
      if (this.elapsed - this.landingCheck > 0.18) {
        this.landingCandidate = this.findLanding();
        this.landingCheck = this.elapsed;
      }
      if (this.landingCandidate) {
        const name = this.landingCandidate.island.name;
        this.currentAction = { type: 'disembark', short: 'BAJAR' };
        this.showPrompt(isCoarse ? 'USAR' : 'E', `Desembarcar en ${name}`, 'BAJAR');
      } else {
        this.currentAction = { type: 'none', short: 'USAR' };
        this.hidePrompt();
      }
      return;
    }
    const rec = this.getNearestInteraction();
    if (rec) {
      const desc = this.describeInteraction(rec);
      this.currentAction = { type: 'use', rec, short: desc.short };
      this.showPrompt(isCoarse ? desc.short : 'E', desc.text, desc.short);
      return;
    }
    if (this.aim) {
      const text = this.aim.kind === 'animal' ? 'Atacar al jabalí' : this.aim.kind === 'tree' ? 'Talar la palmera' : 'Romper la roca';
      this.currentAction = { type: 'attack', short: 'GOLPE' };
      this.showPrompt(isCoarse ? 'GOLPE' : 'CLIC', text, 'GOLPE');
      return;
    }
    if (this.canFishNow()) {
      this.currentAction = { type: 'fish', short: 'PESCA' };
      this.showPrompt(isCoarse ? 'PESCA' : 'F', 'Pescar en estas aguas', 'PESCA');
      return;
    }
    this.currentAction = { type: 'none', short: 'USAR' };
    this.hidePrompt();
  }

  showPrompt(key, text, short) {
    if (this.lastPromptKey !== key) {
      this.el.prompt.querySelector('.key').textContent = key;
      this.lastPromptKey = key;
    }
    if (this.lastPromptText !== text) {
      this.el.promptText.textContent = text;
      this.lastPromptText = text;
    }
    this.el.prompt.classList.remove('hidden');
    if (this.el.tInteract.textContent !== short) this.el.tInteract.textContent = short;
  }

  hidePrompt() {
    this.el.prompt.classList.add('hidden');
    if (this.el.tInteract.textContent !== 'USAR') this.el.tInteract.textContent = 'USAR';
  }

  getNearestInteraction() {
    const p = this.player;
    let best = null;
    let bestD = Infinity;
    for (const rec of this.world.interactables) {
      if (rec.disabled) continue;
      if (rec.type === 'raft' && (!this.world.raftBuilt || this.player.onRaft)) continue;
      if (rec.type === 'raftsite' && this.world.raftBuilt) continue;
      if (rec.type === 'chest' && rec.opened) continue;
      if (rec.type === 'crate' && rec.opened) continue;
      if (rec.type === 'branch' && !rec.alive) continue;
      if ((rec.type === 'bush' || rec.type === 'vine') && rec.cooldown > 0) continue;
      if (rec.type === 'tree' || rec.type === 'rock') continue;
      const d = Math.hypot(rec.pos.x - p.pos.x, rec.pos.z - p.pos.z);
      if (d < rec.radius && d < bestD) { bestD = d; best = rec; }
    }
    return best;
  }

  describeInteraction(rec) {
    switch (rec.type) {
      case 'branch': return { text: 'Recoger rama (+1 madera)', short: 'RECOGER' };
      case 'bush': return { text: 'Recoger bayas', short: 'RECOGER' };
      case 'vine': return { text: 'Recoger cuerda de liana', short: 'RECOGER' };
      case 'chest': return { text: `Abrir el cofre de ${rec.name}`, short: 'ABRIR' };
      case 'crate': return { text: 'Registrar la caja del naufragio', short: 'ABRIR' };
      case 'spring': return { text: 'Beber agua fresca', short: 'BEBER' };
      case 'fire': {
        if (this.inventory.rawFish > 0) return { text: 'Asar pescado en la hoguera', short: 'COCINAR' };
        if (this.inventory.rawMeat > 0) return { text: 'Asar carne en la hoguera', short: 'COCINAR' };
        return { text: 'Descansar junto al fuego', short: 'DESCANSAR' };
      }
      case 'raftsite': {
        const missing = this.missingRaftMaterials();
        return missing.length
          ? { text: `Astillero: faltan ${missing.join(' · ')}`, short: 'CREAR' }
          : { text: 'Construir la balsa', short: 'CREAR' };
      }
      case 'raft': return { text: 'Subir a la balsa', short: 'SUBIR' };
      case 'beacon': {
        const flares = this.inventory.flare;
        return flares >= 4
          ? { text: 'Lanzar la bengala de rescate', short: 'LANZAR' }
          : { text: `Faro de rescate (${flares}/4 bengalas)`, short: 'VER' };
      }
      default: return { text: 'Usar', short: 'USAR' };
    }
  }

  missingRaftMaterials() {
    const out = [];
    for (const [key, need] of Object.entries(RAFT_COST)) {
      const have = this.inventory[key] || 0;
      if (have < need) out.push(`${need - have} ${ITEM_LABELS[key].toLowerCase()}`);
    }
    return out;
  }

  findLanding() {
    const rp = this.world.raftPos;
    let best = null;
    for (const island of this.world.islands) {
      const dx = rp.x - island.x;
      const dz = rp.z - island.z;
      const dist = Math.hypot(dx, dz);
      if (dist > island.radius * 1.34 || dist < 0.01) continue;
      const dirx = dx / dist, dirz = dz / dist;
      for (let t = 1.1; t >= 0.7; t -= 0.018) {
        const x = island.x + dirx * island.radius * t;
        const z = island.z + dirz * island.radius * t;
        const h = this.world.heightAt(x, z);
        if (h > 0.42) {
          const d = Math.hypot(x - rp.x, z - rp.z);
          if (d < 10.5 && (!best || d < best.d)) {
            best = { pos: new THREE.Vector3(x, h + 0.05, z), island, d };
          }
          break;
        }
      }
    }
    return best;
  }

  findWaterSpot() {
    const p = this.player;
    const h = p.onRaft ? this.world.raftHeading : p.yaw;
    const fx = -Math.sin(h), fz = -Math.cos(h);
    const ox = p.onRaft ? this.world.raftPos.x : p.pos.x;
    const oz = p.onRaft ? this.world.raftPos.z : p.pos.z;
    for (let d = 4.5; d <= 16; d += 1.1) {
      const x = ox + fx * d;
      const z = oz + fz * d;
      if (this.world.heightAt(x, z) < -0.55) return { x, z };
    }
    return null;
  }

  canFishNow() {
    if (!this.tools.rod || this.fishing.state !== 'idle' || this.weather.storm > 0.25) return false;
    if (this.player.onRaft) return true;
    if (this.world.heightAt(this.player.pos.x, this.player.pos.z) < 0.35) return true;
    return Boolean(this.findWaterSpot());
  }
  interact() {
    if (!this.isActive()) return;
    const action = this.currentAction;
    if (action.type === 'disembark') { this.disembark(); return; }
    if (action.type === 'attack') { this.attack(); return; }
    if (action.type === 'fish') { this.fishAction(); return; }
    if (action.type === 'use' && action.rec) this.useRecord(action.rec);
  }

  useRecord(rec) {
    switch (rec.type) {
      case 'branch':
        this.world.takeBranch(rec);
        this.addItem('wood', 1);
        this.audio.pickup();
        this.toast('+1 madera', 'good', 1500);
        break;
      case 'bush':
        rec.cooldown = rec.maxCooldown;
        this.addItem('berries', 2);
        this.audio.pickup();
        this.toast('+2 bayas', 'good', 1700);
        break;
      case 'vine':
        rec.cooldown = rec.maxCooldown;
        this.addItem('rope', 2);
        this.audio.pickup();
        this.toast('+2 cuerda', 'good', 1700);
        break;
      case 'chest':
      case 'crate':
        this.openLoot(rec);
        break;
      case 'spring':
        this.player.thirst = clamp(this.player.thirst + 48, 0, 100);
        rec.cooldown = 3;
        this.audio.drink();
        this.toast('Agua fresca: +48 sed', 'good', 1600);
        break;
      case 'fire':
        this.useFire(rec);
        break;
      case 'raftsite':
        this.buildRaft();
        break;
      case 'raft':
        this.boardRaft();
        break;
      case 'beacon':
        this.useBeacon();
        break;
      default:
        break;
    }
    this.updateHud(true);
  }

  openLoot(rec) {
    if (rec.opened) return;
    rec.opened = true;
    this.audio.pickup();
    if (rec.type === 'chest' && rec.lid) this.world.openChest(rec);
    const parts = [];
    for (const [key, n] of Object.entries(rec.loot || {})) {
      if (!n) continue;
      this.addItem(key, n);
      parts.push(`${n} ${ITEM_LABELS[key]}`);
    }
    if (rec.loot && rec.loot.flare) {
      this.islandFlares.add(rec.islandId);
      const total = this.inventory.flare;
      this.toast(`¡Bengala recuperada! (${total}/4)`, 'flare', 5200);
      this.banner(`BENGALA ${total}/4`);
      this.audio.craft();
      if (total >= 4) {
        setTimeout(() => {
          this.toast('Tienes las 4 bengalas. Vuelve al faro del campamento de la Isla Inicio.', 'flare', 6500);
          this.banner('REGRESA AL FARO');
        }, 1200);
      }
    } else {
      this.toast(parts.length ? `Encuentras: ${parts.join(', ')}.` : 'La caja está vacía.', 'good', 3400);
    }
    if (rec.type === 'crate') this.toast('La caja del naufragio te da esperanzas.', '', 2600);
    this.updateHud(true);
  }

  addItem(key, n) {
    this.inventory[key] = clamp((this.inventory[key] || 0) + n, 0, 999);
    this.updateHud(true);
  }

  useFire(rec) {
    if (this.inventory.rawFish > 0) {
      this.inventory.rawFish -= 1;
      this.inventory.cookedFish += 1;
      this.audio.craft();
      this.toast('Pescado asado. Ya puedes comerlo con Q.', 'good', 2300);
    } else if (this.inventory.rawMeat > 0) {
      this.inventory.rawMeat -= 1;
      this.inventory.cookedMeat += 1;
      this.audio.craft();
      this.toast('Carne asada. Ya puedes comerla con Q.', 'good', 2300);
    } else {
      this.player.stamina = clamp(this.player.stamina + 32, 0, 100);
      this.player.warmth = clamp(this.player.warmth + 8, 0, 100);
      this.toast('Descansas junto al fuego y recuperas energía.', 'good', 1900);
      this.audio.pickup();
    }
  }

  buildRaft() {
    const missing = this.missingRaftMaterials();
    if (missing.length) {
      this.toast(`Faltan materiales: ${missing.join(' · ')}.`, 'bad', 3400);
      this.audio.click();
      return;
    }
    for (const [key, n] of Object.entries(RAFT_COST)) this.inventory[key] -= n;
    this.world.showRaft();
    this.banner('BALSA CONSTRUIDA');
    this.toast('La balsa está en el agua. Acércate a la orilla y pulsa E para subir.', 'good', 6000);
    this.audio.craft();
    this.updateHud(true);
  }

  boardRaft() {
    if (!this.world.raftBuilt) return;
    this.player.onRaft = true;
    this.player.jumping = false;
    this.player.vy = 0;
    this.player.swimming = false;
    this.raftSpeed = 0;
    this.player.pos.set(this.world.raftPos.x, 0.32, this.world.raftPos.z);
    this.el.sailInfo.classList.remove('hidden');
    this.vm.visible = false;
    this.hidePrompt();
    this.cancelFishing();
    this.banner('A BORDO');
    this.toast('W/S avanzar y frenar · A/D girar · E desembarcar cerca de la costa.', 'good', 5600);
    this.audio.click();
  }

  disembark() {
    if (!this.player.onRaft) return;
    const landing = this.findLanding();
    if (!landing) {
      this.toast('Acerca la balsa a la orilla para desembarcar.', 'bad', 2600);
      return;
    }
    this.player.onRaft = false;
    this.player.pos.copy(landing.pos);
    this.player.pos.y = Math.max(this.world.heightAt(landing.pos.x, landing.pos.z), 0.05);
    this.player.swimming = false;
    this.player.jumping = false;
    this.player.vy = 0;
    const isl = landing.island;
    const look = new THREE.Vector3(isl.x - this.player.pos.x, 0, isl.z - this.player.pos.z).normalize();
    this.player.yaw = Math.atan2(-look.x, -look.z);
    this.player.pitch = -0.03;
    this.raftSpeed = 0;
    this.el.sailInfo.classList.add('hidden');
    this.toast(`Desembarcas en ${isl.name}.`, 'good', 2400);
    this.audio.splash();
    this.world.splash(this.player.pos.x, 0.1, this.player.pos.z, 0xd6f4fa, 12, 2);
    this.updateHud(true);
  }
  attack() {
    if (!this.isActive() || this.player.onRaft) return;
    if (this.elapsed < (this.nextAttack || 0)) return;
    this.nextAttack = this.elapsed + 0.42;
    this.swing = 1;
    this.player.stamina = clamp(this.player.stamina - 2.2, 0, 100);
    const aim = this.aim;
    if (!aim) { this.audio.noiseBurst(0.12, 0.06, 500); return; }
    const rec = aim.rec;
    if (aim.kind === 'animal') {
      const dmg = this.tools.spear ? 34 : this.tools.axe ? 17 : 7;
      rec.hp -= dmg;
      rec.hitFlash = 0.16;
      rec.state = 'chase';
      this.audio.hit();
      this.shake = Math.max(this.shake, 0.16);
      this.world.splash(rec.pos.x, rec.pos.y + 0.8, rec.pos.z, 0xc94a2f, 12, 2.2);
      if (rec.hp <= 0) {
        rec.alive = false;
        rec.deathTimer = 0;
        this.stats.boars++;
        this.addItem('rawMeat', 2);
        this.toast('Jabalí abatido. +2 carne cruda (asa la carne en una hoguera).', 'good', 3800);
        this.audio.pickup();
      }
    } else if (aim.kind === 'tree') {
      const dmg = this.tools.axe ? 1.05 : 0.38;
      rec.hp -= dmg;
      this.audio.chop();
      this.shake = Math.max(this.shake, 0.12);
      this.world.splash(rec.pos.x, rec.pos.y + 1.5, rec.pos.z, 0x8f6a3c, 9, 1.7);
      if (rec.hp <= 0) {
        this.world.harvestTree(rec);
        this.addItem('wood', 3);
        if (rec.coconuts > 0) this.addItem('coconut', rec.coconuts);
        this.audio.pickup();
        this.toast(`+3 madera${rec.coconuts ? ` y +${rec.coconuts} coco` : ''}`, 'good', 2200);
      }
    } else if (aim.kind === 'rock') {
      const dmg = this.tools.axe ? 1.15 : 0.3;
      rec.hp -= dmg;
      this.audio.mine();
      this.shake = Math.max(this.shake, 0.13);
      this.world.splash(rec.pos.x, rec.pos.y + 0.5, rec.pos.z, 0xa8a89c, 8, 1.6);
      if (rec.hp <= 0) {
        this.world.harvestRock(rec);
        this.addItem('stone', 2);
        this.audio.pickup();
        this.toast('+2 piedra', 'good', 1900);
      }
    }
    this.updateHud(true);
  }

  eat() {
    if (!this.isActive()) return;
    for (const [key, hunger, thirst, health] of EAT_PRIORITY) {
      if (this.inventory[key] > 0) {
        this.inventory[key] -= 1;
        this.player.hunger = clamp(this.player.hunger + hunger, 0, 100);
        this.player.thirst = clamp(this.player.thirst + thirst, 0, 100);
        this.player.health = clamp(this.player.health + health, 0, 100);
        this.audio.eat();
        const label = ITEM_LABELS[key];
        if (health < 0) this.toast(`Comes ${label.toLowerCase()}… no sienta muy bien.`, 'bad', 2300);
        else this.toast(`Comes ${label.toLowerCase()}. +${hunger} hambre${thirst ? `, +${thirst} sed` : ''}.`, 'good', 2200);
        this.updateHud(true);
        return;
      }
    }
    this.toast('No tienes comida. Recoge bayas, cocos o pesca algo.', 'bad', 2500);
  }

  useBeacon() {
    const flares = this.inventory.flare;
    if (flares < 4) {
      this.toast(`El faro necesita 4 bengalas. Tienes ${flares}. Explora los refugios de las otras islas.`, 'bad', 4500);
      this.audio.click();
      return;
    }
    this.win();
  }

  win() {
    if (this.victory) return;
    this.victory = true;
    this.victoryTime = 0;
    this.hidePrompt();
    this.cancelFishing();
    this.exitLock();
    this.world.lightBeacon();
    this.world.showRescueShip();
    this.world.rescueShip.position.set(118, 0, 44);
    this.weather.phase = 'clear';
    this.weather.storm = 0;
    this.weather.label = 'Despejado';
    this.audio.setStorm(0);
    this.audio.victory();
    this.banner('SEÑAL LANZADA');
    const time = this.elapsed - this.runStart;
    this.el.victoryStats.innerHTML = `
      <div class="stat"><b>${formatDuration(time)}</b><span>Tiempo</span></div>
      <div class="stat"><b>${this.visited.size}/5</b><span>Islas</span></div>
      <div class="stat"><b>${this.stats.fish}</b><span>Pescados</span></div>
      <div class="stat"><b>${this.stats.boars}</b><span>Jabalíes</span></div>
      <div class="stat"><b>${this.stats.storms}</b><span>Tormentas</span></div>
      <div class="stat"><b>${this.stats.deaths}</b><span>Caídas</span></div>`;
    setTimeout(() => {
      this.el.victoryScreen.classList.remove('hidden');
      this.el.touch.classList.add('hidden');
    }, 1300);
  }

  craft(id) {
    const recipe = RECIPES.find(r => r.id === id);
    if (!recipe) return;
    if (recipe.once && this.tools[id]) return;
    for (const [key, n] of Object.entries(recipe.cost)) {
      if ((this.inventory[key] || 0) < n) {
        this.toast(`Faltan materiales para ${recipe.name.toLowerCase()}.`, 'bad');
        return;
      }
    }
    for (const [key, n] of Object.entries(recipe.cost)) this.inventory[key] -= n;
    if (recipe.once) this.tools[id] = true;
    if (id === 'bandage') this.player.health = clamp(this.player.health + 35, 0, 100);
    this.audio.craft();
    this.toast(`Has fabricado: ${recipe.name}.`, 'good', 2600);
    if (id === 'rod') this.toast('Con la caña, pulsa F mirando al agua para pescar.', '', 3800);
    if (id === 'axe') this.toast('El hacha permite talar y minar mucho más rápido.', '', 3400);
    if (id === 'spear') this.toast('La lanza hace mucho más daño a los jabalíes.', '', 3400);
    this.renderCraft();
    this.updateHud(true);
  }

  renderCraft() {
    const inv = this.inventory;
    const chips = [];
    for (const key of ITEM_ORDER) {
      const n = inv[key] || 0;
      if (n <= 0 && key !== 'flare') continue;
      chips.push(`<span class="inv-chip">${ITEM_ICONS[key]} ${ITEM_LABELS[key]} <b>${n}</b></span>`);
    }
    for (const [id, owned] of Object.entries(this.tools)) {
      if (owned) chips.push(`<span class="inv-chip">✓ ${RECIPES.find(r => r.id === id)?.name || id}</span>`);
    }
    this.el.craftInventory.innerHTML = chips.join('') || '<span class="inv-chip">Todavía no llevas nada encima.</span>';

    this.el.recipeList.innerHTML = RECIPES.map(recipe => {
      const owned = recipe.once && this.tools[recipe.id];
      const costs = Object.entries(recipe.cost).map(([key, n]) => {
        const have = inv[key] || 0;
        return `<span class="cost ${have >= n ? 'ok' : 'no'}">${ITEM_ICONS[key]} ${have}/${n}</span>`;
      }).join('');
      const can = !owned && Object.entries(recipe.cost).every(([key, n]) => (inv[key] || 0) >= n);
      const label = owned ? 'FABRICADA' : can ? 'CREAR' : 'FALTA';
      return `<div class="recipe">
        <div class="recipe-icon">${recipe.icon}</div>
        <div>
          <div class="recipe-name">${recipe.name}</div>
          <div class="recipe-desc">${recipe.desc}</div>
          <div class="recipe-cost">${costs}</div>
        </div>
        <button class="craft-btn ${owned ? 'done' : ''}" data-recipe="${recipe.id}" ${can ? '' : 'disabled'}>${label}</button>
      </div>`;
    }).join('');
  }
  fishAction() {
    if (!this.isActive()) return;
    if (this.fishing.state === 'idle') this.startFishing();
    else if (this.fishing.state === 'bite') this.catchFish();
    else if (this.fishing.state === 'cast') this.cancelFishing('Recoges la caña antes de tiempo.');
  }

  startFishing() {
    if (!this.tools.rod) {
      this.toast('Necesitas una caña de pescar. Fabrícala con 3 madera y 2 cuerda (C).', 'bad', 4200);
      return;
    }
    if (this.weather.storm > 0.25) {
      this.toast('Con esta tormenta es imposible pescar.', 'bad', 2500);
      return;
    }
    const spot = this.findWaterSpot();
    if (!spot) {
      this.toast('Acércate a la orilla y mira hacia el agua para lanzar la caña.', 'bad', 3000);
      return;
    }
    this.fishing.state = 'cast';
    this.fishing.timer = 0;
    this.fishing.duration = 2.2 + Math.random() * 3.2;
    this.fishing.spot = spot;
    this.fishing.startX = this.player.pos.x;
    this.fishing.startZ = this.player.pos.z;
    this.hidePrompt();
    this.setFishingVisible(true);
    this.el.fishingLabel.textContent = 'Esperando una picada…';
    this.el.fishingLabel.classList.remove('bite');
    this.el.fishingFill.classList.remove('bite');
    this.el.fishingFill.style.width = '0%';
    this.audio.splash();
    this.world.splash(spot.x, 0.12, spot.z, 0xcdeff5, 10, 1.7);
    this.audio.click();
  }

  updateFishing(dt) {
    if (this.fishing.state === 'idle') return;
    if (this.fishing.state === 'cast') {
      this.fishing.timer += dt;
      this.el.fishingFill.style.width = `${Math.min(100, (this.fishing.timer / this.fishing.duration) * 100).toFixed(0)}%`;
      if (this.fishing.timer >= this.fishing.duration) {
        this.fishing.state = 'bite';
        this.fishing.timer = 1.55;
        this.el.fishingLabel.textContent = '¡PICÓ! ¡Pulsa F!';
        this.el.fishingLabel.classList.add('bite');
        this.el.fishingFill.classList.add('bite');
        this.el.fishingFill.style.width = '100%';
        this.audio.bite();
        const s = this.fishing.spot;
        if (s) this.world.splash(s.x, 0.14, s.z, 0xd9f8ff, 16, 2.4);
      }
    } else if (this.fishing.state === 'bite') {
      this.fishing.timer -= dt;
      if (this.fishing.timer <= 0) this.cancelFishing('El pez se soltó. Prueba otra vez.');
    }
  }

  catchFish() {
    const s = this.fishing.spot;
    const amount = Math.random() < 0.22 ? 2 : 1;
    this.inventory.rawFish += amount;
    this.stats.fish += amount;
    this.audio.pickup();
    this.audio.splash();
    if (s) this.world.splash(s.x, 0.15, s.z, 0xd8f6ff, 18, 2.6);
    this.toast(`¡Has pescado ${amount} pez${amount > 1 ? 'es' : ''}! Asado alimenta más.`, 'good', 3400);
    this.fishing.state = 'idle';
    this.setFishingVisible(false);
    this.updateHud(true);
  }

  cancelFishing(message) {
    const was = this.fishing.state !== 'idle';
    this.fishing.state = 'idle';
    this.fishing.spot = null;
    this.setFishingVisible(false);
    if (message && was) this.toast(message, '', 2200);
  }

  setFishingVisible(visible) {
    if (!this.bobber) return;
    this.bobber.visible = visible;
    this.rodLine.visible = visible;
    this.el.fishingUi.classList.toggle('hidden', !visible);
    if (!visible) {
      this.el.fishingFill.style.width = '0%';
      this.el.fishingLabel.classList.remove('bite');
      this.el.fishingFill.classList.remove('bite');
    }
  }

  updateFishingVisual() {
    if (this.fishing.state === 'idle' || !this.fishing.spot) return;
    const spot = this.fishing.spot;
    const bite = this.fishing.state === 'bite';
    const y = 0.11 + Math.sin(this.elapsed * 2.4) * 0.03 + (bite ? -0.09 : 0);
    this.bobber.position.set(spot.x, y, spot.z);
    this.bobber.rotation.y += 0.02;
    const tip = this.camera.localToWorld(new THREE.Vector3(0.2, -0.08, -1.05));
    const pos = this.rodLine.geometry.attributes.position;
    pos.setXYZ(0, tip.x, tip.y, tip.z);
    pos.setXYZ(1, spot.x, y, spot.z);
    pos.needsUpdate = true;
  }

  updateViewModel(dt) {
    if (!this.vm) return;
    if (!this.started || this.player.onRaft || this.dead || this.victory || this.paused || this.modalOpen) {
      this.vm.visible = false;
      if (this.torchLight) this.torchLight.intensity = 0;
      return;
    }
    let tool = 'fist';
    if (this.fishing.state !== 'idle') tool = 'rod';
    else if (this.aim && this.aim.kind === 'animal' && this.tools.spear) tool = 'spear';
    else if (this.aim && (this.aim.kind === 'tree' || this.aim.kind === 'rock') && this.tools.axe) tool = 'axe';
    else if (this.aim && this.aim.kind === 'animal' && this.tools.axe) tool = 'axe';
    else if (this.isNight() && this.tools.torch) tool = 'torch';
    else if (this.tools.spear && this.player.stamina > 40) tool = 'spear';

    for (const [id, group] of Object.entries(this.vmTools)) group.visible = id === tool;
    this.vm.visible = true;
    if (this.torchLight) this.torchLight.intensity = tool === 'torch' ? 1.7 : 0;

    if (this.swing > 0) this.swing = Math.max(0, this.swing - dt * 4.3);
    const arm = this.swing > 0 ? Math.sin((1 - this.swing) * Math.PI) : 0;
    const g = this.vmTools[tool];
    const base = g.userData.basePos;
    const br = g.userData.baseRot;
    g.position.x = base.x + Math.sin(this.elapsed * 1.35) * 0.006 + arm * 0.03;
    g.position.y = base.y + this.player.bob * 0.45 + Math.sin(this.elapsed * 2.1) * 0.004;
    g.position.z = base.z - arm * 0.22;
    g.rotation.x = br.x - arm * 1.15;
    g.rotation.y = br.y + Math.sin(this.elapsed * 1.1) * 0.008;
    g.rotation.z = br.z + Math.sin(this.elapsed * 0.9) * 0.006 - arm * 0.22;
  }
  updateHud(arg) {
    const force = arg === true;
    const dt = typeof arg === 'number' ? arg : 0;
    this.hudTimer += dt;
    if (!force && this.hudTimer < 0.13) return;
    this.hudTimer = 0;
    const p = this.player;
    const setVital = (name, value) => {
      const node = this.el.vitals[name];
      if (!node) return;
      node.fill.style.width = `${clamp(value, 0, 100).toFixed(1)}%`;
      node.val.textContent = String(Math.round(value));
    };
    setVital('health', p.health);
    setVital('hunger', p.hunger);
    setVital('thirst', p.thirst);
    setVital('warmth', p.warmth);
    setVital('stamina', p.stamina);

    this.el.clock.textContent = formatClock(this.timeOfDay);
    this.el.weather.textContent = this.weather.label;
    this.el.weather.classList.toggle('storm', this.weather.phase === 'storm' || this.weather.phase === 'warning');

    this.el.invWood.textContent = this.inventory.wood;
    this.el.invStone.textContent = this.inventory.stone;
    this.el.invRope.textContent = this.inventory.rope;
    this.el.invCloth.textContent = this.inventory.cloth;
    this.el.invFood.textContent = FOOD_KEYS.reduce((n, k) => n + this.inventory[k], 0);
    this.el.invFlare.textContent = this.inventory.flare;

    this.updateQuest();
    if (p.onRaft) {
      this.el.sailSpeed.textContent = String(Math.round(Math.abs(this.raftSpeed) * 0.8));
    }
    if (force || this.elapsed - this.lastMapDraw > 0.16) {
      this.lastMapDraw = this.elapsed;
      this.drawMinimap();
    }
  }

  updateQuest() {
    const inv = this.inventory;
    let text = '';
    let extra = '';
    if (!this.world.raftBuilt) {
      text = 'Reúne materiales y construye la balsa en el astillero de la Isla Inicio.';
      extra = Object.entries(RAFT_COST).map(([key, need]) => {
        const have = inv[key] || 0;
        return `<span class="qchip ${have >= need ? 'ok' : 'no'}">${have}/${need} ${ITEM_LABELS[key]}</span>`;
      }).join('');
    } else if (inv.flare < 4) {
      text = `Recupera las bengalas de los cuatro refugios (${inv.flare}/4).`;
      extra = OUTER_ISLANDS.map(isl => {
        const got = this.islandFlares.has(isl.id);
        return `<span class="qchip ${got ? 'ok' : 'no'}">${got ? '✓' : '○'} ${SHORT_NAMES[isl.id]}</span>`;
      }).join('');
    } else {
      text = 'Vuelve al faro del campamento de la Isla Inicio y lanza la señal de rescate.';
      extra = `<span class="qchip ok">✓ 4/4 bengalas</span><span class="qchip no">Faro pendiente</span>`;
    }
    if (this.el.questText.textContent !== text) this.el.questText.textContent = text;
    if (this.el.questExtra.innerHTML !== extra) this.el.questExtra.innerHTML = extra;
  }

  drawMinimap() {
    const ctx = this.mapCtx;
    if (!ctx) return;
    const W = 320, cx = 160, cy = 160, R = 154;
    const scale = 0.7;
    const mapX = x => cx + (x - 0) * scale;
    const mapY = z => cy + (z - 34) * scale;
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();

    const water = ctx.createRadialGradient(cx, cy, 20, cx, cy, R);
    water.addColorStop(0, '#0d3c48');
    water.addColorStop(1, '#061b22');
    ctx.fillStyle = water;
    ctx.fillRect(0, 0, W, W);

    ctx.strokeStyle = 'rgba(180, 220, 225, 0.08)';
    ctx.lineWidth = 1;
    for (let r = 40; r < 160; r += 38) {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }
    for (let a = 0; a < 4; a++) {
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a * Math.PI / 2) * 20, cy + Math.sin(a * Math.PI / 2) * 20);
      ctx.lineTo(cx + Math.cos(a * Math.PI / 2) * 150, cy + Math.sin(a * Math.PI / 2) * 150);
      ctx.stroke();
    }

    const pulse = 0.6 + Math.sin(this.elapsed * 3) * 0.4;
    for (const island of this.world.islands) {
      const x = mapX(island.x);
      const y = mapY(island.z);
      const r = island.radius * scale;
      const known = this.visited.has(island.id);
      ctx.globalAlpha = known ? 0.95 : 0.6;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = island.mapColor;
      ctx.fill();
      ctx.strokeStyle = 'rgba(5, 25, 30, 0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.84, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(245, 232, 190, 0.35)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (island.id === 'home') {
        ctx.fillStyle = '#ffd98a';
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
      }
      // shelter dot
      if (island.shelterPos) {
        const sx = mapX(island.shelterPos.x);
        const sy = mapY(island.shelterPos.z);
        ctx.fillStyle = 'rgba(245, 235, 205, 0.8)';
        ctx.fillRect(sx - 3, sy - 3, 6, 6);
      }
    }

    // rafts and raft site
    const home = this.world.islands[0];
    if (!this.world.raftBuilt && home.raftSitePos) {
      const x = mapX(home.raftSitePos.x), y = mapY(home.raftSitePos.z);
      ctx.strokeStyle = `rgba(255, 205, 110, ${0.45 + pulse * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 7 + pulse * 2, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffcf73';
      ctx.fillRect(x - 4, y - 4, 8, 8);
    }
    if (this.world.raftBuilt) {
      const x = mapX(this.world.raftPos.x), y = mapY(this.world.raftPos.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(-Math.cos(this.world.raftHeading), -Math.sin(this.world.raftHeading)));
      ctx.fillStyle = '#6fe4d6';
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, 4.5); ctx.lineTo(-5, -4.5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // flare markers and beacon-ready marker
    const outer = this.world.islands.filter(i => i.id !== 'home');
    for (const island of outer) {
      const got = this.islandFlares.has(island.id);
      if (got) continue;
      const sx = mapX(island.shelterPos.x);
      const sy = mapY(island.shelterPos.z);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = `rgba(255, 190, 80, ${0.55 + pulse * 0.4})`;
      ctx.fillRect(-4, -4, 8, 8);
      ctx.restore();
    }
    if (this.inventory.flare >= 4) {
      const x = mapX(home.beaconPos.x), y = mapY(home.beaconPos.z);
      ctx.strokeStyle = `rgba(255, 220, 120, ${0.4 + pulse * 0.6})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, 9 + pulse * 4, 0, Math.PI * 2); ctx.stroke();
    }

    // player
    const px = mapX(this.player.pos.x);
    const py = mapY(this.player.pos.z);
    const heading = this.player.onRaft ? this.world.raftHeading : this.player.yaw;
    const angle = Math.atan2(-Math.cos(heading), -Math.sin(heading));
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(this.player.onRaft ? 10 : 9, 0); ctx.lineTo(-6, 5.5); ctx.lineTo(-3, 0); ctx.lineTo(-6, -5.5); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();

    ctx.restore();
    ctx.strokeStyle = 'rgba(238, 244, 232, 0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, R - 1, 0, Math.PI * 2); ctx.stroke();
  }
}

function bootGame() {
  try {
    window.__islandGame = new Game();
  } catch (error) {
    console.error(error);
    const boot = document.getElementById('boot');
    if (boot) {
      boot.innerHTML = '<div class="boot-text" style="max-width:520px;text-align:center;line-height:1.6">No se pudo iniciar el juego 3D.<br>Comprueba que tu navegador permite WebGL.<br><br>' +
        String(error && error.message ? error.message : error).replace(/[<>&]/g, '') + '</div>';
      boot.classList.remove('done');
    }
  }
}

bootGame();










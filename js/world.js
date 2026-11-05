import * as THREE from './vendor/three.module.js';
import { ISLANDS } from './config.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, seed) {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

function fbm(x, y, seed) {
  let value = 0, amp = 0.55, freq = 1;
  for (let i = 0; i < 4; i++) {
    value += amp * valueNoise(x * freq, y * freq, seed + i * 13);
    freq *= 2.03;
    amp *= 0.5;
  }
  return value;
}

const PALETTE = {
  day: {
    top: new THREE.Color('#2d7fc6'), bottom: new THREE.Color('#c3e6ea'),
    sun: new THREE.Color('#fff2c9'), fog: new THREE.Color('#b7dbe2'),
    deep: new THREE.Color('#0a4d5e'), shallow: new THREE.Color('#3aa89c'),
    hemiSky: new THREE.Color('#a8dcff'), hemiGround: new THREE.Color('#6f5a3b'),
    sunLight: new THREE.Color('#fff0ce'), cloud: new THREE.Color('#f7fbfd'),
    sunIntensity: 2.25, hemiIntensity: 1.0,
  },
  dusk: {
    top: new THREE.Color('#334a7c'), bottom: new THREE.Color('#ff9c60'),
    sun: new THREE.Color('#ffb46b'), fog: new THREE.Color('#dfa083'),
    deep: new THREE.Color('#0b3548'), shallow: new THREE.Color('#3b7f83'),
    hemiSky: new THREE.Color('#ffb48a'), hemiGround: new THREE.Color('#5a4535'),
    sunLight: new THREE.Color('#ffb072'), cloud: new THREE.Color('#ffcbb0'),
    sunIntensity: 1.8, hemiIntensity: 0.75,
  },
  night: {
    top: new THREE.Color('#050d1c'), bottom: new THREE.Color('#0d2238'),
    sun: new THREE.Color('#8fb6ff'), fog: new THREE.Color('#0c1f30'),
    deep: new THREE.Color('#04141f'), shallow: new THREE.Color('#0d3a44'),
    hemiSky: new THREE.Color('#4c6f9e'), hemiGround: new THREE.Color('#1e1a16'),
    sunLight: new THREE.Color('#9db9e8'), cloud: new THREE.Color('#40536a'),
    sunIntensity: 0.5, hemiIntensity: 0.34,
  },
  storm: new THREE.Color('#3f4c54'),
};

function colorMix(out, a, b, t) {
  out.copy(a).lerp(b, clamp(t, 0, 1));
  return out;
}

export class World {
  constructor(scene, renderer, options = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.lowQuality = !!options.lowQuality;
    this.colliders = [];
    this.interactables = [];
    this.animals = [];
    this.fires = [];
    this.foamRings = [];
    this.chestLids = [];
    this.effects = [];
    this.clouds = [];
    this.shelters = [];
    this.time = 8;
    this.storm = 0;
    this.flash = 0;
    this.raftBuilt = false;
    this.raftPos = new THREE.Vector3();
    this.raftHeading = 0;
    this.raftMoving = 0;
    this.elapsed = 0;
    this._tmpColor = new THREE.Color();
    this._tmpColor2 = new THREE.Color();
    this._vec = new THREE.Vector3();
    this._sunDir = new THREE.Vector3();
    this._lightDir = new THREE.Vector3();
    this._moonDir = new THREE.Vector3();

    this.islands = ISLANDS.map(def => {
      const island = { ...def };
      island.shelterPos = new THREE.Vector3(
        def.x + Math.cos(def.shelterAngle) * def.radius * 0.53,
        0,
        def.z + Math.sin(def.shelterAngle) * def.radius * 0.53,
      );
      island.shelterY = clamp(this.rawHeightAt(island, island.shelterPos.x, island.shelterPos.z), 1.6, def.peak * 0.72);
      island.shelterPos.y = island.shelterY;
      island.spawnAngle = def.spawnAngle ?? def.shelterAngle;
      island.spawnPos = new THREE.Vector3(
        def.x + Math.cos(island.spawnAngle) * def.radius * 0.78,
        0,
        def.z + Math.sin(island.spawnAngle) * def.radius * 0.78,
      );
      if (def.raftAngle !== undefined) {
        island.raftSitePos = new THREE.Vector3(
          def.x + Math.cos(def.raftAngle) * def.radius * 0.84,
          0,
          def.z + Math.sin(def.raftAngle) * def.radius * 0.84,
        );
        island.raftWaterPos = new THREE.Vector3(
          def.x + Math.cos(def.raftAngle) * def.radius * 1.07,
          0,
          def.z + Math.sin(def.raftAngle) * def.radius * 1.07,
        );
        island.raftWaterPos.y = 0.3;
      }
      return island;
    });

    for (const island of this.islands) {
      island.spawnPos.y = this.heightAt(island.spawnPos.x, island.spawnPos.z);
      if (island.raftSitePos) island.raftSitePos.y = this.heightAt(island.raftSitePos.x, island.raftSitePos.z);
      island.beaconPos = island.shelterPos.clone().add(new THREE.Vector3(3.4, 0, 2.6));
      island.beaconPos.y = this.heightAt(island.beaconPos.x, island.beaconPos.z);
    }

    this.buildSky();
    this.buildLights();
    this.buildOcean();
    this.buildIslands();
    this.buildShelters();
    this.buildRaft();
    this.buildRain();
    this.buildProps();
    this.buildAnimals();
    this.buildRescueShip();
  }

  // ---- terrain ---------------------------------------------------------
  rawHeightAt(island, x, z) {
    const dx = (x - island.x) / island.radius;
    const dz = (z - island.z) / island.radius;
    const r2 = dx * dx + dz * dz;
    if (r2 > 1.24 * 1.24) return -9;
    const dome = Math.max(0, 1 - r2);
    let h = -1.75 + Math.pow(dome, 1.02) * (island.peak + 1.75);
    const mask = Math.pow(dome, 1.65);
    h += (fbm((x + island.seed * 17) * 0.055, (z - island.seed * 11) * 0.055, island.seed) - 0.5) * 3.4 * mask;
    h += (valueNoise(x * 0.23, z * 0.23, island.seed + 9) - 0.5) * 0.65 * mask;
    return h;
  }

  heightAt(x, z) {
    let best = -9;
    for (const island of this.islands) {
      const r2 = ((x - island.x) ** 2 + (z - island.z) ** 2) / (island.radius * island.radius);
      if (r2 > 1.24 * 1.24) continue;
      let h = this.rawHeightAt(island, x, z);
      const sd = Math.hypot(x - island.shelterPos.x, z - island.shelterPos.z);
      if (sd < 6.2) {
        const t = 1 - smoothstep(3.0, 6.2, sd);
        h = lerp(h, island.shelterY, t * 0.94);
      }
      if (h > best) best = h;
    }
    return best;
  }

  islandAt(x, z) {
    let best = null;
    for (const island of this.islands) {
      const d = Math.hypot(x - island.x, z - island.z);
      if (d < island.radius * 1.06 && (!best || d < best.d)) best = { island, d };
    }
    return best;
  }

  buildIslands() {
    const rings = 30, segs = 92;
    for (const island of this.islands) {
      const maxR = island.radius * 1.22;
      const positions = [];
      const colors = [];
      const indices = [];
      const rng = mulberry32(island.seed * 991);
      for (let i = 0; i <= rings; i++) {
        const r = maxR * (i / rings);
        for (let s = 0; s < segs; s++) {
          const a = (s / segs) * Math.PI * 2;
          const x = island.x + Math.cos(a) * r;
          const z = island.z + Math.sin(a) * r;
          const y = this.heightAt(x, z);
          positions.push(x, y, z);
          const tint = (rng() - 0.5) * 0.115;
          let base;
          if (y < 0.15) base = new THREE.Color('#b7a06b');
          else if (y < 1.55) base = new THREE.Color('#e4cd92');
          else if (y < island.peak * 0.52) base = new THREE.Color('#6aa65a');
          else if (y < island.peak * 0.78) base = new THREE.Color('#4f8547');
          else base = new THREE.Color('#8b8b7c');
          base.offsetHSL(0, 0, tint);
          colors.push(base.r, base.g, base.b);
        }
      }
      for (let i = 0; i < rings; i++) {
        for (let s = 0; s < segs; s++) {
          const a = i * segs + s;
          const b = i * segs + (s + 1) % segs;
          const c = (i + 1) * segs + s;
          const d = (i + 1) * segs + (s + 1) % segs;
          indices.push(a, b, c, b, d, c);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 1, metalness: 0, flatShading: true,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      // gentle foam ring at the shoreline
      const shoreR = island.radius * 0.91;
      const foamGeo = new THREE.RingGeometry(shoreR * 0.94, shoreR * 1.035, 96);
      foamGeo.rotateX(-Math.PI / 2);
      const foamMat = new THREE.MeshBasicMaterial({
        color: 0xdffbff, transparent: true, opacity: 0.12,
        depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const foam = new THREE.Mesh(foamGeo, foamMat);
      foam.position.set(island.x, 0.07, island.z);
      this.scene.add(foam);
      this.foamRings.push({ mesh: foam, phase: Math.random() * 10 });
    }
  }

  // ---- sky / lights / ocean --------------------------------------------
  buildSky() {
    const geo = new THREE.SphereGeometry(1500, 40, 24);
    this.skyUniforms = {
      topColor: { value: new THREE.Color('#2d7fc6') },
      bottomColor: { value: new THREE.Color('#c3e6ea') },
      sunColor: { value: new THREE.Color('#fff2c9') },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      storm: { value: 0 },
      flash: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: this.skyUniforms,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform vec3 sunColor;
        uniform vec3 sunDir;
        uniform float storm;
        uniform float flash;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 col = mix(bottomColor, topColor, pow(h, 0.58));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          col += sunColor * pow(s, 320.0) * 1.6;
          col += sunColor * pow(s, 9.0) * 0.10;
          col = mix(col, vec3(0.17, 0.20, 0.23), storm * 0.72);
          col += vec3(0.75, 0.82, 1.0) * flash * 0.55;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // stars
    const starCount = 850;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const y = Math.pow(Math.random(), 0.65) * 0.95 + 0.03;
      const r = Math.sqrt(1 - y * y);
      starPos[i * 3] = Math.cos(theta) * r * 1200;
      starPos[i * 3 + 1] = y * 1200;
      starPos[i * 3 + 2] = Math.sin(theta) * r * 1200;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xdfefff, size: 2.1, sizeAttenuation: false, transparent: true,
      opacity: 0, depthWrite: false, fog: false,
    });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    // sun + glow
    this.sun = new THREE.Mesh(
      new THREE.SphereGeometry(22, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff3c4, fog: false }),
    );
    this.sun.frustumCulled = false;
    this.scene.add(this.sun);
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.makeGlowTexture(), color: 0xffddaa, transparent: true,
      opacity: 0.85, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false,
    }));
    this.sunGlow.scale.setScalar(250);
    this.scene.add(this.sunGlow);

    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(17, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xdbe6ff, fog: false }),
    );
    this.moon.frustumCulled = false;
    this.scene.add(this.moon);
    this.moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.makeGlowTexture(), color: 0x9dc0ff, transparent: true,
      opacity: 0.5, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false,
    }));
    this.moonGlow.scale.setScalar(120);
    this.scene.add(this.moonGlow);

    // clouds
    const cloudMat = new THREE.MeshBasicMaterial({
      color: 0xf7fbfd, transparent: true, opacity: 0.72, depthWrite: false, fog: false,
    });
    this.cloudMat = cloudMat;
    const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 13; i++) {
      const group = new THREE.Group();
      const puffs = 3 + Math.floor(Math.random() * 4);
      for (let p = 0; p < puffs; p++) {
        const m = new THREE.Mesh(cloudGeo, cloudMat);
        m.position.set((Math.random() - 0.5) * 26, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 16);
        m.scale.set(10 + Math.random() * 15, 2.6 + Math.random() * 3, 7 + Math.random() * 9);
        group.add(m);
      }
      const angle = Math.random() * Math.PI * 2;
      const dist = 90 + Math.random() * 360;
      group.position.set(Math.cos(angle) * dist, 78 + Math.random() * 55, Math.sin(angle) * dist);
      group.userData.speed = 0.7 + Math.random() * 1.1;
      this.scene.add(group);
      this.clouds.push(group);
    }
  }

  makeGlowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.65)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xa8dcff, 0x6f5a3b, 1.0);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.12);
    this.scene.add(this.ambient);
    this.sunLight = new THREE.DirectionalLight(0xfff0ce, 2.2);
    this.sunLight.castShadow = !this.lowQuality;
    if (!this.lowQuality) {
      this.sunLight.shadow.mapSize.set(1024, 1024);
      this.sunLight.shadow.camera.left = -52;
      this.sunLight.shadow.camera.right = 52;
      this.sunLight.shadow.camera.top = 52;
      this.sunLight.shadow.camera.bottom = -52;
      this.sunLight.shadow.camera.near = 1;
      this.sunLight.shadow.camera.far = 190;
      this.sunLight.shadow.bias = -0.0006;
      this.sunLight.shadow.normalBias = 0.035;
    }
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
    this.scene.fog = new THREE.Fog(0xb7dbe2, 70, 360);
  }

  buildOcean() {
    const geo = new THREE.PlaneGeometry(1700, 1700, 170, 170);
    geo.rotateX(-Math.PI / 2);
    this.oceanUniforms = {
      uTime: { value: 0 },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      deepColor: { value: new THREE.Color('#0a4d5e') },
      shallowColor: { value: new THREE.Color('#3aa89c') },
      fogColor: { value: new THREE.Color('#b7dbe2') },
      fogNear: { value: 60 },
      fogFar: { value: 360 },
      sunColor: { value: new THREE.Color('#fff2c9') },
      uStorm: { value: 0 },
      uFlash: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.oceanUniforms,
      vertexShader: `
        uniform float uTime;
        uniform float uStorm;
        varying vec3 vWorld;
        varying vec3 vNormalW;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float amp = 0.30 + uStorm * 0.55;
          float w1 = sin(wp.x * 0.055 + uTime * 0.9) * 0.30;
          float w2 = sin(wp.z * 0.072 - uTime * 0.7) * 0.23;
          float w3 = sin((wp.x + wp.z) * 0.035 + uTime * 0.52) * 0.34;
          float w4 = sin((wp.x - wp.z) * 0.12 - uTime * 1.5) * 0.09 * (0.4 + uStorm);
          wp.y += (w1 + w2 + w3 + w4) * amp;
          float dx = cos(wp.x * 0.055 + uTime * 0.9) * 0.055 * 0.30
                   + cos((wp.x + wp.z) * 0.035 + uTime * 0.52) * 0.035 * 0.34
                   + cos((wp.x - wp.z) * 0.12 - uTime * 1.5) * 0.12 * 0.09 * (0.4 + uStorm);
          float dz = cos(wp.z * 0.072 - uTime * 0.7) * 0.072 * 0.23
                   + cos((wp.x + wp.z) * 0.035 + uTime * 0.52) * 0.035 * 0.34
                   - cos((wp.x - wp.z) * 0.12 - uTime * 1.5) * 0.12 * 0.09 * (0.4 + uStorm);
          vNormalW = normalize(vec3(-dx * amp, 1.0, -dz * amp));
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 sunDir;
        uniform vec3 deepColor;
        uniform vec3 shallowColor;
        uniform vec3 fogColor;
        uniform vec3 sunColor;
        uniform float fogNear;
        uniform float fogFar;
        uniform float uStorm;
        uniform float uFlash;
        varying vec3 vWorld;
        varying vec3 vNormalW;
        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(dot(viewDir, normalize(vNormalW)), 0.0), 2.3);
          vec3 base = mix(deepColor, shallowColor, fres * 0.75 + 0.12);
          vec3 h = normalize(normalize(sunDir) + viewDir);
          float spec = pow(max(dot(normalize(vNormalW), h), 0.0), 90.0);
          vec3 col = base + sunColor * spec * 0.9;
          col += vec3(0.55, 0.65, 0.75) * uFlash * 0.35;
          col = mix(col, vec3(0.23, 0.30, 0.33), uStorm * 0.35);
          float dist = length(cameraPosition - vWorld);
          float f = smoothstep(fogNear, fogFar, dist);
          col = mix(col, fogColor, f);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.ocean = new THREE.Mesh(geo, mat);
    this.ocean.frustumCulled = false;
    this.ocean.position.y = 0;
    this.scene.add(this.ocean);
  }

  // ---- shelters / props ------------------------------------------------
  makeSign(text, position, rotationY, scale = 1) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 192;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#6e4c2c';
    ctx.fillRect(0, 0, 512, 192);
    ctx.strokeStyle = '#4b311c';
    ctx.lineWidth = 14;
    ctx.strokeRect(7, 7, 498, 178);
    ctx.fillStyle = '#f4dfac';
    ctx.font = 'bold 74px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 100);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const group = new THREE.Group();
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 1.1, 0.12),
      [new THREE.MeshStandardMaterial({ color: 0x6e4c2c, roughness: 1 }),
        new THREE.MeshStandardMaterial({ color: 0x6e4c2c, roughness: 1 }),
        new THREE.MeshStandardMaterial({ color: 0x6e4c2c, roughness: 1 }),
        new THREE.MeshStandardMaterial({ color: 0x6e4c2c, roughness: 1 }),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }),
        new THREE.MeshStandardMaterial({ color: 0x4b311c, roughness: 1 })],
    );
    board.position.y = 2.0;
    board.castShadow = true;
    group.add(board);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x5a3d23, roughness: 1 });
    for (const x of [-1.15, 1.15]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.0, 6), postMat);
      post.position.set(x, 1.0, 0);
      post.castShadow = true;
      group.add(post);
    }
    group.position.copy(position);
    group.rotation.y = rotationY;
    group.scale.setScalar(scale);
    this.scene.add(group);
    return group;
  }

  buildShelters() {
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.95 });
    const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x4f3620, roughness: 1 });
    const thatchMat = new THREE.MeshStandardMaterial({ color: 0xc7a35a, roughness: 1, flatShading: true });
    const leafRoofMat = new THREE.MeshStandardMaterial({ color: 0x8c9d4a, roughness: 1, flatShading: true });
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8b8c82, roughness: 1, flatShading: true });

    for (const island of this.islands) {
      const dirX = island.shelterPos.x - island.x;
      const dirZ = island.shelterPos.z - island.z;
      const rotY = Math.atan2(dirX, dirZ);
      const group = new THREE.Group();
      group.position.copy(island.shelterPos);
      group.rotation.y = rotY;
      this.scene.add(group);

      // floor
      const floor = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.16, 4.6), darkWoodMat);
      floor.position.y = 0.06;
      floor.receiveShadow = true;
      group.add(floor);

      // posts
      for (const px of [-2.05, 2.05]) {
        for (const pz of [-2.05, 2.05]) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 2.7, 6), woodMat);
          post.position.set(px, 1.4, pz);
          post.castShadow = true;
          group.add(post);
        }
      }
      // back + side walls
      const back = new THREE.Mesh(new THREE.BoxGeometry(4.35, 2.0, 0.13), leafRoofMat);
      back.position.set(0, 1.15, -2.05);
      back.castShadow = true;
      group.add(back);
      for (const px of [-2.05, 2.05]) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(0.13, 2.0, 4.35), leafRoofMat);
        side.position.set(px, 1.15, 0);
        side.castShadow = true;
        group.add(side);
      }
      // roof
      const roof = new THREE.Mesh(new THREE.ConeGeometry(3.65, 1.75, 4), thatchMat);
      roof.position.y = 3.15;
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      group.add(roof);
      // ridge beams
      for (const x of [-1.1, 1.1]) {
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.4, 5), darkWoodMat);
        beam.position.set(x, 2.72, 0);
        beam.rotation.z = Math.PI / 2;
        group.add(beam);
      }

      // chest inside
      const chestPos = new THREE.Vector3(0, island.shelterY + 0.15, -1.15);
      chestPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      chestPos.x += island.shelterPos.x;
      chestPos.z += island.shelterPos.z;
      const chest = this.makeChest(chestPos.x, chestPos.y, chestPos.z, rotY + Math.PI, island);
      this.interactables.push(chest);

      // campfire outside the door
      const fireOffset = new THREE.Vector3(0, 0, 3.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      const fireX = island.shelterPos.x + fireOffset.x;
      const fireZ = island.shelterPos.z + fireOffset.z;
      const fire = this.makeFire(fireX, this.heightAt(fireX, fireZ), fireZ, island.id === 'home' ? 1.1 : 0.9);
      this.fires.push(fire);
      this.interactables.push({
        type: 'fire', id: `fire-${island.id}`, islandId: island.id,
        pos: new THREE.Vector3(fireX, fire.group.position.y + 0.5, fireZ),
        radius: 2.4, fire,
      });

      // freshwater spring
      const springOffset = new THREE.Vector3(4.7, 0, 1.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      const sx = island.shelterPos.x + springOffset.x;
      const sz = island.shelterPos.z + springOffset.z;
      const sy = this.heightAt(sx, sz);
      const spring = new THREE.Group();
      spring.position.set(sx, sy, sz);
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.25, 0.35, 9), stoneMat);
      basin.position.y = 0.12;
      basin.receiveShadow = true;
      spring.add(basin);
      const water = new THREE.Mesh(
        new THREE.CircleGeometry(0.92, 24),
        new THREE.MeshStandardMaterial({
          color: 0x5fd6df, transparent: true, opacity: 0.85,
          roughness: 0.12, metalness: 0.05, emissive: 0x0b4852, emissiveIntensity: 0.35,
        }),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.31;
      spring.add(water);
      for (let i = 0; i < 5; i++) {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + Math.random() * 0.16, 0), stoneMat);
        const a = (i / 5) * Math.PI * 2;
        rock.position.set(Math.cos(a) * 1.15, 0.18, Math.sin(a) * 1.15);
        rock.rotation.set(Math.random(), Math.random(), Math.random());
        spring.add(rock);
      }
      this.scene.add(spring);
      this.interactables.push({
        type: 'spring', id: `spring-${island.id}`, islandId: island.id,
        pos: new THREE.Vector3(sx, sy + 0.4, sz), radius: 2.1, mesh: spring,
        cooldown: 0,
      });

      // shelter sign
      const signOffset = new THREE.Vector3(-3.3, 0, 3.4).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      const signX = island.shelterPos.x + signOffset.x;
      const signZ = island.shelterPos.z + signOffset.z;
      this.makeSign(island.id === 'home' ? 'CAMPAMENTO' : 'REFUGIO', new THREE.Vector3(signX, this.heightAt(signX, signZ), signZ), rotY, 0.6);
      this.shelters = this.shelters || [];
      this.shelters.push({
        islandId: island.id, pos: island.shelterPos.clone(),
        fire, chest, radius: 4.7,
      });
    }

    // rescue beacon at home
    this.buildBeacon();
  }

  makeChest(x, y, z, rotY, island) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = rotY;
    const wood = new THREE.MeshStandardMaterial({ color: 0x7d542f, roughness: 0.9 });
    const band = new THREE.MeshStandardMaterial({ color: 0x9c8c5a, roughness: 0.55, metalness: 0.35 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.72, 0.92), wood);
    base.position.y = 0.36;
    base.castShadow = true;
    group.add(base);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.24, 0.96), wood);
    lid.position.set(0, 0.82, 0);
    lid.castShadow = true;
    group.add(lid);
    for (const bx of [-0.42, 0.42]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.78, 0.96), band);
      strip.position.set(bx, 0.4, 0);
      group.add(strip);
      const lock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.08), band);
      lock.position.set(bx, 0.73, 0.49);
      group.add(lock);
    }
    this.scene.add(group);
    const loot = island.id === 'home'
      ? { cloth: 2, cookedFish: 1, berries: 2, rope: 1 }
      : { flare: 1, cloth: 1, cookedFish: 1 };
    if (island.id === 'rocks') loot.stone = 3;
    if (island.id === 'skull') loot.rope = 2;
    if (island.id === 'mist') loot.coconut = 1;
    return {
      type: 'chest', id: `chest-${island.id}`, islandId: island.id,
      pos: new THREE.Vector3(x, y + 0.6, z), radius: 2.0,
      group, lid, loot, opened: false, name: island.name,
    };
  }

  makeFire(x, y, z, scale = 1) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x898a80, roughness: 1, flatShading: true });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.24 * scale, 0), stoneMat);
      s.position.set(Math.cos(a) * 0.78 * scale, 0.14 * scale, Math.sin(a) * 0.78 * scale);
      s.rotation.set(Math.random(), Math.random(), Math.random());
      s.castShadow = true;
      group.add(s);
    }
    const logMat = new THREE.MeshStandardMaterial({ color: 0x4d321b, roughness: 1 });
    for (let i = 0; i < 4; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09 * scale, 0.11 * scale, 1.15 * scale, 6), logMat);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = (i / 4) * Math.PI;
      log.position.y = 0.18 * scale;
      group.add(log);
    }
    const flames = [];
    const flameMatOuter = new THREE.MeshBasicMaterial({
      color: 0xff7b25, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const flameMatInner = new THREE.MeshBasicMaterial({
      color: 0xffd166, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry((0.28 - i * 0.05) * scale, (0.85 - i * 0.18) * scale, 7), i === 1 ? flameMatInner : flameMatOuter);
      f.position.set((i - 1) * 0.12 * scale, 0.55 * scale, (i % 2 - 0.5) * 0.12 * scale);
      f.userData.phase = Math.random() * 10;
      f.userData.base = f.scale.clone();
      group.add(f);
      flames.push(f);
    }
    const light = new THREE.PointLight(0xff9a4a, 2.6 * scale, 18 * scale, 1.8);
    light.position.set(0, 1.2 * scale, 0);
    group.add(light);
    this.scene.add(group);
    return { group, flames, light, baseIntensity: 2.6 * scale, phase: Math.random() * 10, lit: true };
  }

  buildBeacon() {
    const home = this.islands[0];
    const pos = home.beaconPos;
    const group = new THREE.Group();
    group.position.copy(pos);
    const wood = new THREE.MeshStandardMaterial({ color: 0x5c4027, roughness: 1 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 5.6, 7), wood);
    pole.position.y = 2.8;
    pole.castShadow = true;
    group.add(pole);
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.55, 0.8, 8), new THREE.MeshStandardMaterial({ color: 0x3d2a18, roughness: 1 }));
    basket.position.y = 5.3;
    group.add(basket);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.6, 5), wood);
      stick.position.set(Math.cos(a) * 0.55, 5.0, Math.sin(a) * 0.55);
      stick.rotation.z = Math.cos(a) * 0.35;
      stick.rotation.x = Math.sin(a) * 0.35;
      group.add(stick);
    }
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.8, 2.3, 8),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    flame.position.y = 6.3;
    flame.visible = false;
    group.add(flame);
    const light = new THREE.PointLight(0xffb060, 0, 60, 1.6);
    light.position.y = 6.2;
    group.add(light);
    this.scene.add(group);
    this.beacon = { group, flame, light, lit: false, island: home };
    this.interactables.push({
      type: 'beacon', id: 'beacon-home', islandId: 'home',
      pos: new THREE.Vector3(pos.x, pos.y + 2.2, pos.z), radius: 3.0, beacon: this.beacon,
    });
  }

  // ---- raft -------------------------------------------------------------
  makeRaftMesh(ghost = false) {
    const group = new THREE.Group();
    const logMat = new THREE.MeshStandardMaterial({
      color: ghost ? 0xb08a58 : 0x7a5330, roughness: 1,
      transparent: ghost, opacity: ghost ? 0.5 : 1,
    });
    const ropeMat = new THREE.MeshStandardMaterial({
      color: ghost ? 0xd8c39b : 0xb79a63, roughness: 1,
      transparent: ghost, opacity: ghost ? 0.6 : 1,
    });
    const logGeo = new THREE.CylinderGeometry(0.23, 0.23, 4.4, 7);
    logGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 7; i++) {
      const log = new THREE.Mesh(logGeo, logMat);
      log.position.set((i - 3) * 0.48, 0.2, 0);
      log.castShadow = !ghost;
      group.add(log);
    }
    for (const z of [-1.45, 0, 1.45]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(3.35, 0.15, 0.28), ropeMat);
      beam.position.set(0, 0.47, z);
      group.add(beam);
    }
    // mast
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 4.4, 7), logMat);
    mast.position.set(0, 2.4, -0.4);
    mast.castShadow = !ghost;
    group.add(mast);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), logMat);
    boom.position.set(0, 3.1, -0.4);
    boom.rotation.z = Math.PI / 2;
    group.add(boom);
    // sail
    const sailCanvas = document.createElement('canvas');
    sailCanvas.width = 256; sailCanvas.height = 256;
    const ctx = sailCanvas.getContext('2d');
    ctx.fillStyle = '#f0e2c2';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#d8c49a';
    for (let i = 0; i < 4; i++) ctx.fillRect(0, i * 64 + 46, 256, 8);
    ctx.fillStyle = '#b45a3c';
    ctx.beginPath();
    ctx.arc(128, 120, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f0e2c2';
    ctx.beginPath();
    ctx.arc(128, 120, 28, 0, Math.PI * 2);
    ctx.fill();
    const sailTex = new THREE.CanvasTexture(sailCanvas);
    sailTex.colorSpace = THREE.SRGBColorSpace;
    const sailMat = new THREE.MeshStandardMaterial({
      map: sailTex, side: THREE.DoubleSide, roughness: 1,
      transparent: ghost, opacity: ghost ? 0.45 : 1,
    });
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 2.3, 6, 6), sailMat);
    sail.position.set(0.02, 3.15, -0.4);
    sail.rotation.y = Math.PI / 2;
    sail.castShadow = !ghost;
    group.add(sail);
    // flag
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.85, 0.45),
      new THREE.MeshStandardMaterial({ color: 0xd4553a, side: THREE.DoubleSide, roughness: 1 }),
    );
    flag.position.set(0.45, 4.35, -0.4);
    flag.rotation.y = Math.PI / 2;
    group.add(flag);
    // foam ring
    const foam = new THREE.Mesh(
      new THREE.RingGeometry(1.0, 1.55, 24),
      new THREE.MeshBasicMaterial({
        color: 0xd9fbff, transparent: true, opacity: ghost ? 0.02 : 0.28,
        depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }),
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.y = 0.05;
    group.add(foam);
    group.userData.foam = foam;
    group.userData.sail = sail;
    return group;
  }

  buildRaft() {
    const home = this.islands[0];
    // construction site
    this.raftSite = this.makeRaftMesh(true);
    this.raftSite.position.copy(home.raftSitePos);
    this.raftSite.position.y += 0.25;
    this.raftSite.rotation.y = -0.4;
    this.scene.add(this.raftSite);
    this.raftSitePos = home.raftSitePos.clone();
    this.interactables.push({
      type: 'raftsite', id: 'raftsite-home', islandId: 'home',
      pos: new THREE.Vector3(home.raftSitePos.x, home.raftSitePos.y + 0.7, home.raftSitePos.z),
      radius: 3.1, ghost: this.raftSite,
    });
    this.makeSign('ASTILLERO', new THREE.Vector3(home.raftSitePos.x + 2.4, home.raftSitePos.y, home.raftSitePos.z + 1.8), -0.4, 0.65);

    // actual raft, hidden until built
    this.raft = this.makeRaftMesh(false);
    this.raft.visible = false;
    this.raftPos.copy(home.raftWaterPos);
    this.raftHeading = -0.4;
    this.raft.position.copy(this.raftPos);
    this.raft.rotation.y = this.raftHeading;
    this.scene.add(this.raft);
    this.interactables.push({
      type: 'raft', id: 'raft', islandId: 'home',
      pos: new THREE.Vector3(), radius: 4.2, group: this.raft,
    });
    this.raftInteractable = this.interactables[this.interactables.length - 1];
  }

  showRaft() {
    this.raftBuilt = true;
    this.raft.visible = true;
    this.raftSite.visible = false;
    const site = this.interactables.find(i => i.type === 'raftsite');
    if (site) site.disabled = true;
  }

  setRaftTransform(x, z, heading, moving) {
    this.raftPos.set(x, 0, z);
    this.raftHeading = heading;
    this.raftMoving = moving;
  }

  // ---- props ------------------------------------------------------------
  buildProps() {
    const allTrees = [];
    const allRocks = [];
    const allBushes = [];
    const allBranches = [];
    const treeRand = mulberry32(7741);
    const rockRand = mulberry32(9917);
    const bushRand = mulberry32(4241);
    const branchRand = mulberry32(3313);

    for (const island of this.islands) {
      const isHome = island.id === 'home';
      const treeCount = isHome ? 17 : 13;
      const rockCount = isHome ? 8 : 9;
      const bushCount = isHome ? 9 : 8;
      const vineCount = isHome ? 6 : 4;
      const branchCount = isHome ? 12 : 6;

      const blocked = (x, z, extra = 0) => {
        if (Math.hypot(x - island.shelterPos.x, z - island.shelterPos.z) < 8.5 + extra) return true;
        if (island.spawnPos && Math.hypot(x - island.spawnPos.x, z - island.spawnPos.z) < 7 + extra) return true;
        if (island.raftSitePos && Math.hypot(x - island.raftSitePos.x, z - island.raftSitePos.z) < 9 + extra) return true;
        return false;
      };

      for (let i = 0; i < treeCount; i++) {
        let x, z, h, tries = 0;
        do {
          const a = treeRand() * Math.PI * 2;
          const r = (0.24 + treeRand() * 0.6) * island.radius;
          x = island.x + Math.cos(a) * r;
          z = island.z + Math.sin(a) * r;
          h = this.heightAt(x, z);
          tries++;
        } while ((h < 1.0 || blocked(x, z, -2)) && tries < 40);
        if (h < 0.9) continue;
        const scale = 0.8 + treeRand() * 0.55;
        const rec = {
          type: 'tree', id: `tree-${island.id}-${i}`, islandId: island.id,
          pos: new THREE.Vector3(x, h, z), radius: 2.6,
          scale, trunkIdx: allTrees.length, hp: 3, maxHp: 3, alive: true,
          rot: treeRand() * Math.PI * 2,
          coconuts: 1 + (treeRand() > 0.45 ? 1 : 0),
        };
        allTrees.push(rec);
        const col = { x, z, r: 0.42 * scale, rec };
        this.colliders.push(col);
        rec.collider = col;
        this.interactables.push(rec);
      }

      for (let i = 0; i < rockCount; i++) {
        let x, z, h, tries = 0;
        do {
          const a = rockRand() * Math.PI * 2;
          const r = (0.28 + rockRand() * 0.52) * island.radius;
          x = island.x + Math.cos(a) * r;
          z = island.z + Math.sin(a) * r;
          h = this.heightAt(x, z);
          tries++;
        } while ((h < 0.5 || blocked(x, z)) && tries < 40);
        if (h < 0.3) continue;
        const sx = 0.7 + rockRand() * 1.35;
        const sy = 0.5 + rockRand() * 0.9;
        const sz = 0.7 + rockRand() * 1.2;
        const rec = {
          type: 'rock', id: `rock-${island.id}-${i}`, islandId: island.id,
          pos: new THREE.Vector3(x, h, z), radius: 2.2,
          rockIdx: allRocks.length, hp: 3.2, maxHp: 3.2, alive: true,
          scale: new THREE.Vector3(sx, sy, sz), rot: new THREE.Euler(rockRand() * 0.3, rockRand() * Math.PI * 2, rockRand() * 0.3),
        };
        allRocks.push(rec);
        const col = { x, z, r: Math.max(sx, sz) * 0.65, rec };
        this.colliders.push(col);
        rec.collider = col;
        this.interactables.push(rec);
      }

      for (let i = 0; i < bushCount; i++) {
        let x, z, h, tries = 0;
        do {
          const a = bushRand() * Math.PI * 2;
          const r = (0.3 + bushRand() * 0.55) * island.radius;
          x = island.x + Math.cos(a) * r;
          z = island.z + Math.sin(a) * r;
          h = this.heightAt(x, z);
          tries++;
        } while ((h < 0.8 || blocked(x, z, -3)) && tries < 40);
        if (h < 0.7) continue;
        const s = 0.7 + bushRand() * 0.6;
        const rec = {
          type: 'bush', id: `bush-${island.id}-${i}`, islandId: island.id,
          pos: new THREE.Vector3(x, h, z), radius: 2.0,
          bushIdx: allBushes.length, cooldown: 0, maxCooldown: 42, scale: s,
          rot: bushRand() * Math.PI * 2,
        };
        allBushes.push(rec);
        this.interactables.push(rec);
      }

      // vine patches (rope source) - small individual groups
      for (let i = 0; i < vineCount; i++) {
        let x, z, h, tries = 0;
        do {
          const a = bushRand() * Math.PI * 2;
          const r = (0.36 + bushRand() * 0.46) * island.radius;
          x = island.x + Math.cos(a) * r;
          z = island.z + Math.sin(a) * r;
          h = this.heightAt(x, z);
          tries++;
        } while ((h < 1.0 || blocked(x, z, -2)) && tries < 40);
        if (h < 0.9) continue;
        const group = new THREE.Group();
        group.position.set(x, h, z);
        const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7d4b, roughness: 1, flatShading: true });
        const stemMat = new THREE.MeshStandardMaterial({ color: 0x8a7a45, roughness: 1 });
        for (let v = 0; v < 4; v++) {
          const a = (v / 4) * Math.PI * 2 + Math.random() * 0.5;
          const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.9, 5), leafMat);
          leaf.position.set(Math.cos(a) * 0.3, 0.9, Math.sin(a) * 0.3);
          leaf.rotation.z = Math.cos(a) * 0.45;
          leaf.rotation.x = Math.sin(a) * 0.45;
          leaf.castShadow = true;
          group.add(leaf);
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.5, 5), stemMat);
          stem.position.set(Math.cos(a) * 0.15, 0.75, Math.sin(a) * 0.15);
          group.add(stem);
        }
        this.scene.add(group);
        const rec = {
          type: 'vine', id: `vine-${island.id}-${i}`, islandId: island.id,
          pos: new THREE.Vector3(x, h + 0.8, z), radius: 2.2,
          cooldown: 0, maxCooldown: 46, group,
        };
        this.interactables.push(rec);
      }

      // loose branches on the beach
      for (let i = 0; i < branchCount; i++) {
        let x, z, h, tries = 0;
        do {
          const a = branchRand() * Math.PI * 2;
          const r = (0.58 + branchRand() * 0.28) * island.radius;
          x = island.x + Math.cos(a) * r;
          z = island.z + Math.sin(a) * r;
          h = this.heightAt(x, z);
          tries++;
        } while ((h < 0.25 || h > 2.6 || blocked(x, z, -4)) && tries < 40);
        if (h < 0.2) continue;
        const rec = {
          type: 'branch', id: `branch-${island.id}-${i}`, islandId: island.id,
          pos: new THREE.Vector3(x, h, z), radius: 1.7,
          branchIdx: allBranches.length, alive: true,
          rot: new THREE.Euler(0, branchRand() * Math.PI * 2, branchRand() * 0.2),
        };
        allBranches.push(rec);
        this.interactables.push(rec);
      }
    }

    // ---- instanced trees ----
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.42, 4.9, 6);
    trunkGeo.translate(0, 2.45, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7f5a35, roughness: 1, flatShading: true });
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, allTrees.length);
    trunkMesh.castShadow = !this.lowQuality;
    trunkMesh.receiveShadow = true;
    this.trees = allTrees;
    const frondGeo = new THREE.ConeGeometry(0.5, 2.9, 4, 1, true);
    frondGeo.translate(0, 1.45, 0);
    frondGeo.rotateZ(-Math.PI / 2);
    const frondMat = new THREE.MeshStandardMaterial({
      color: 0x2f8f4e, roughness: 1, flatShading: true, side: THREE.DoubleSide,
    });
    const frondMesh = new THREE.InstancedMesh(frondGeo, frondMat, allTrees.length * 8);
    frondMesh.castShadow = !this.lowQuality;
    const coconutGeo = new THREE.SphereGeometry(0.2, 7, 6);
    const coconutMat = new THREE.MeshStandardMaterial({ color: 0x5b3d20, roughness: 1 });
    const coconutMesh = new THREE.InstancedMesh(coconutGeo, coconutMat, allTrees.length * 2);
    coconutMesh.castShadow = !this.lowQuality;

    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const color = new THREE.Color();
    const rng = mulberry32(5150);
    let frondIdx = 0, coconutIdx = 0;
    for (const rec of allTrees) {
      const scale = rec.scale;
      const topY = rec.pos.y + 4.9 * scale;
      m4.compose(rec.pos, new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
      trunkMesh.setMatrixAt(rec.trunkIdx, m4);
      trunkMesh.setColorAt(rec.trunkIdx, color.setHSL(0.08, 0.3, 0.3 + rng() * 0.12));
      rec.trunkBase = rec.trunkIdx;
      rec.frondStart = frondIdx;
      for (let f = 0; f < 8; f++) {
        const yaw = (f / 8) * Math.PI * 2 + rng() * 0.5;
        const tilt = -0.18 - rng() * 0.2;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        const tiltQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt);
        q.multiply(tiltQ);
        v.set(rec.pos.x, topY, rec.pos.z);
        s.set(0.85 + rng() * 0.25, 0.85 + rng() * 0.2, 0.85 + rng() * 0.25);
        m4.compose(v, q, s);
        frondMesh.setMatrixAt(frondIdx, m4);
        frondMesh.setColorAt(frondIdx, color.setHSL(0.29 + rng() * 0.055, 0.48, 0.28 + rng() * 0.13));
        // store for later hiding
        frondIdx++;
      }
      rec.coconutStart = coconutIdx;
      for (let c = 0; c < 2; c++) {
        const a = rng() * Math.PI * 2;
        v.set(rec.pos.x + Math.cos(a) * 0.38, topY - 0.45 - rng() * 0.3, rec.pos.z + Math.sin(a) * 0.38);
        m4.compose(v, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
        coconutMesh.setMatrixAt(coconutIdx, m4);
        coconutIdx++;
      }
    }
    trunkMesh.instanceMatrix.needsUpdate = true;
    frondMesh.instanceMatrix.needsUpdate = true;
    coconutMesh.instanceMatrix.needsUpdate = true;
    if (trunkMesh.instanceColor) trunkMesh.instanceColor.needsUpdate = true;
    if (frondMesh.instanceColor) frondMesh.instanceColor.needsUpdate = true;
    this.scene.add(trunkMesh, frondMesh, coconutMesh);
    this.trunkMesh = trunkMesh;
    this.frondMesh = frondMesh;
    this.coconutMesh = coconutMesh;

    // ---- rocks ----
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8e9087, roughness: 1, flatShading: true });
    const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, allRocks.length);
    rockMesh.castShadow = !this.lowQuality;
    rockMesh.receiveShadow = true;
    for (const rec of allRocks) {
      v.set(rec.pos.x, rec.pos.y + rec.scale.y * 0.34, rec.pos.z);
      q.setFromEuler(rec.rot);
      m4.compose(v, q, rec.scale);
      rockMesh.setMatrixAt(rec.rockIdx, m4);
      rockMesh.setColorAt(rec.rockIdx, color.setHSL(0.12, 0.04, 0.4 + rng() * 0.18));
    }
    rockMesh.instanceMatrix.needsUpdate = true;
    if (rockMesh.instanceColor) rockMesh.instanceColor.needsUpdate = true;
    this.scene.add(rockMesh);
    this.rockMesh = rockMesh;
    this.rocks = allRocks;

    // ---- bushes ----
    const bushGeo = new THREE.IcosahedronGeometry(0.7, 1);
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x3d8848, roughness: 1, flatShading: true });
    const bushMesh = new THREE.InstancedMesh(bushGeo, bushMat, allBushes.length);
    bushMesh.castShadow = !this.lowQuality;
    for (const rec of allBushes) {
      v.set(rec.pos.x, rec.pos.y + 0.42 * rec.scale, rec.pos.z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rec.rot);
      m4.compose(v, q, new THREE.Vector3(rec.scale, rec.scale * 0.72, rec.scale));
      bushMesh.setMatrixAt(rec.bushIdx, m4);
      bushMesh.setColorAt(rec.bushIdx, color.setHSL(0.2 + rng() * 0.05, 0.42, 0.27 + rng() * 0.09));
    }
    bushMesh.instanceMatrix.needsUpdate = true;
    if (bushMesh.instanceColor) bushMesh.instanceColor.needsUpdate = true;
    this.scene.add(bushMesh);
    this.bushMesh = bushMesh;
    this.bushes = allBushes;

    // ---- loose branches ----
    const branchGeo = new THREE.CylinderGeometry(0.07, 0.1, 1.5, 5);
    branchGeo.rotateZ(Math.PI / 2);
    branchGeo.translate(0, 0.08, 0);
    const branchMat = new THREE.MeshStandardMaterial({ color: 0x7a5836, roughness: 1 });
    const branchMesh = new THREE.InstancedMesh(branchGeo, branchMat, allBranches.length);
    branchMesh.castShadow = !this.lowQuality;
    for (const rec of allBranches) {
      v.set(rec.pos.x, rec.pos.y + 0.08, rec.pos.z);
      q.setFromEuler(rec.rot);
      m4.compose(v, q, new THREE.Vector3(1, 1, 1));
      branchMesh.setMatrixAt(rec.branchIdx, m4);
      branchMesh.setColorAt(rec.branchIdx, color.setHSL(0.08, 0.3, 0.28 + rng() * 0.1));
    }
    branchMesh.instanceMatrix.needsUpdate = true;
    if (branchMesh.instanceColor) branchMesh.instanceColor.needsUpdate = true;
    this.scene.add(branchMesh);
    this.branchMesh = branchMesh;
    this.branches = allBranches;

    // ---- grass tufts ----
    const tuftGeo = (() => {
      const positions = [];
      const indices = [];
      let vi = 0;
      for (let b = 0; b < 3; b++) {
        const yaw = (b / 3) * Math.PI + b * 0.22;
        const dx = Math.cos(yaw), dz = Math.sin(yaw);
        const w = 0.06, hgt = 0.58 + b * 0.07, bend = 0.13;
        positions.push(
          -dx * w, 0, -dz * w,
          dx * w, 0, dz * w,
          -dx * w * 0.3 + dz * bend, hgt, -dz * w * 0.3 - dx * bend,
          dx * w * 0.3 + dz * bend, hgt, dz * w * 0.3 - dx * bend,
        );
        indices.push(vi, vi + 1, vi + 3, vi, vi + 3, vi + 2);
        vi += 4;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setIndex(indices);
      const normals = new Float32Array(positions.length);
      for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
      geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      return geo;
    })();
    const tuftMat = new THREE.MeshStandardMaterial({
      color: 0x5fa14a, roughness: 1, flatShading: true, side: THREE.DoubleSide,
    });
    const grassRand = mulberry32(6621);
    const tufts = [];
    for (const island of this.islands) {
      const count = this.lowQuality ? 48 : 78;
      for (let i = 0; i < count; i++) {
        const a = grassRand() * Math.PI * 2;
        const r = (0.16 + grassRand() * 0.68) * island.radius;
        const x = island.x + Math.cos(a) * r;
        const z = island.z + Math.sin(a) * r;
        const h = this.heightAt(x, z);
        if (h < 1.1) continue;
        if (Math.hypot(x - island.shelterPos.x, z - island.shelterPos.z) < 4.5) continue;
        if (island.spawnPos && Math.hypot(x - island.spawnPos.x, z - island.spawnPos.z) < 4) continue;
        tufts.push({
          x, y: h, z,
          rot: grassRand() * Math.PI * 2,
          scale: 0.7 + grassRand() * 0.85,
          lean: (grassRand() - 0.5) * 0.35,
        });
      }
    }
    const tuftMesh = new THREE.InstancedMesh(tuftGeo, tuftMat, tufts.length);
    tuftMesh.receiveShadow = true;
    const tuftQ = new THREE.Quaternion();
    const tuftE = new THREE.Euler();
    tufts.forEach((t, i) => {
      tuftE.set(t.lean, t.rot, t.lean * 0.6);
      tuftQ.setFromEuler(tuftE);
      v.set(t.x, t.y - 0.04, t.z);
      const sc = t.scale;
      m4.compose(v, tuftQ, new THREE.Vector3(sc, sc * (0.85 + (i % 5) * 0.075), sc));
      tuftMesh.setMatrixAt(i, m4);
      tuftMesh.setColorAt(i, color.setHSL(0.23 + rng() * 0.07, 0.38 + rng() * 0.16, 0.28 + rng() * 0.12));
    });
    tuftMesh.instanceMatrix.needsUpdate = true;
    if (tuftMesh.instanceColor) tuftMesh.instanceColor.needsUpdate = true;
    this.scene.add(tuftMesh);
    this.tuftMesh = tuftMesh;

    // ---- home shipwreck crate ----
    this.makeWreckCrate();
  }

  makeWreckCrate() {
    const home = this.islands[0];
    const angle = home.spawnAngle - 0.42;
    const x = home.x + Math.cos(angle) * home.radius * 0.79;
    const z = home.z + Math.sin(angle) * home.radius * 0.79;
    const y = this.heightAt(x, z);
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = 0.7;
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6239, roughness: 0.95 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x543822, roughness: 1 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 1.1), wood);
    base.position.y = 0.45;
    base.rotation.z = 0.04;
    base.castShadow = true;
    group.add(base);
    for (const x of [-0.55, 0.55]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.95, 1.16), dark);
      band.position.set(x, 0.47, 0);
      group.add(band);
    }
    // broken lid
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.12, 1.15), wood);
    lid.position.set(0.35, 0.98, -0.42);
    lid.rotation.set(0.2, 0.2, 0.35);
    group.add(lid);
    this.scene.add(group);
    this.interactables.push({
      type: 'crate', id: 'crate-home', islandId: 'home',
      pos: new THREE.Vector3(x, y + 0.6, z), radius: 2.0,
      loot: { cloth: 2, rope: 2, wood: 2 }, opened: false, group,
    });
  }

  // ---- animals ----------------------------------------------------------
  makeBoarMesh() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x61452c, roughness: 0.95, flatShading: true });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x745437, roughness: 0.95, flatShading: true });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x33241a, roughness: 1 });
    const tuskMat = new THREE.MeshStandardMaterial({ color: 0xe9dfc3, roughness: 0.6 });

    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.86, 1), bodyMat);
    body.scale.set(1.35, 0.78, 0.9);
    body.position.y = 0.95;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Group();
    head.position.set(0, 0.96, 0.95);
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), headMat);
    skull.scale.set(1.0, 0.9, 1.2);
    skull.castShadow = true;
    head.add(skull);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 0.5), headMat);
    snout.position.set(0, -0.12, 0.42);
    head.add(snout);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.1), darkMat);
    nose.position.set(0, -0.12, 0.68);
    head.add(nose);
    for (const sx of [-0.22, 0.22]) {
      const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.34, 5), tuskMat);
      tusk.position.set(sx, -0.2, 0.56);
      tusk.rotation.x = Math.PI * 0.65;
      head.add(tusk);
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.32, 4), headMat);
      ear.position.set(sx * 1.5, 0.35, -0.05);
      ear.rotation.z = sx * 0.5;
      head.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), darkMat);
      eye.position.set(sx * 0.78, 0.12, 0.36);
      head.add(eye);
    }
    group.add(head);

    const legs = [];
    const legGeo = new THREE.BoxGeometry(0.17, 0.72, 0.19);
    for (const lx of [-0.5, 0.5]) {
      for (const lz of [-0.48, 0.48]) {
        const leg = new THREE.Mesh(legGeo, darkMat);
        leg.position.set(lx, 0.36, lz);
        leg.castShadow = true;
        group.add(leg);
        legs.push(leg);
      }
    }
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.02, 0.55, 4), darkMat);
    tail.position.set(0, 1.02, -0.95);
    tail.rotation.x = 0.8;
    group.add(tail);
    group.userData = { body, head, legs, tail };
    return group;
  }

  buildAnimals() {
    const rng = mulberry32(8813);
    for (const island of this.islands) {
      const count = island.id === 'home' ? 1 : 3;
      for (let i = 0; i < count; i++) {
        let x, z, h, tries = 0;
        do {
          const a = rng() * Math.PI * 2;
          const r = (0.28 + rng() * 0.44) * island.radius;
          x = island.x + Math.cos(a) * r;
          z = island.z + Math.sin(a) * r;
          h = this.heightAt(x, z);
          tries++;
        } while ((h < 1.0 || Math.hypot(x - island.shelterPos.x, z - island.shelterPos.z) < 14
          || (island.spawnPos && Math.hypot(x - island.spawnPos.x, z - island.spawnPos.z) < 22)) && tries < 40);
        if (h < 0.8) continue;
        const group = this.makeBoarMesh();
        group.position.set(x, h, z);
        const scale = 0.9 + rng() * 0.28;
        group.scale.setScalar(scale);
        this.scene.add(group);
        this.animals.push({
          id: `boar-${island.id}-${i}`, kind: 'boar', islandId: island.id,
          group, pos: new THREE.Vector3(x, h, z),
          home: new THREE.Vector3(x, h, z),
          hp: 100, maxHp: 100, alive: true, state: 'wander',
          heading: rng() * Math.PI * 2, speed: 3.7 * scale,
          attackCd: 0, wanderTimer: rng() * 3,
          target: new THREE.Vector3(x, h, z),
          phase: rng() * 10, hitFlash: 0, deathTimer: 0, scale,
        });
      }
    }
  }

  resetAnimal(animal) {
    const island = this.islands.find(i => i.id === animal.islandId);
    animal.alive = true;
    animal.hp = animal.maxHp;
    animal.state = 'wander';
    animal.deathTimer = 0;
    animal.group.visible = true;
    animal.group.rotation.set(0, animal.heading, 0);
    animal.group.position.copy(animal.home);
    animal.pos.copy(animal.home);
    animal.group.scale.setScalar(animal.scale);
    if (island && Math.hypot(animal.home.x - island.x, animal.home.z - island.z) > island.radius * 0.8) {
      animal.home.copy(island.spawnPos);
    }
  }

  // ---- rain / effects ---------------------------------------------------
  buildRain() {
    const count = this.lowQuality ? 620 : 1100;
    this.rainCount = count;
    this.rainDrops = [];
    const positions = new Float32Array(count * 2 * 3);
    for (let i = 0; i < count; i++) {
      this.rainDrops.push({
        x: (Math.random() - 0.5) * 70,
        y: Math.random() * 40,
        z: (Math.random() - 0.5) * 70,
        speed: 22 + Math.random() * 16,
      });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.rainMat = new THREE.LineBasicMaterial({
      color: 0xa8cddd, transparent: true, opacity: 0, depthWrite: false,
    });
    this.rain = new THREE.LineSegments(geo, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  splash(x, y, z, color = 0xbfefff, count = 18, power = 2.4) {
    const positions = new Float32Array(count * 3);
    const velocities = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * power;
      velocities.push(
        Math.cos(a) * (0.5 + Math.random()) * power * 0.45,
        up,
        Math.sin(a) * (0.5 + Math.random()) * power * 0.45,
      );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color, size: 0.13, transparent: true, opacity: 0.95, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.effects.push({ points, velocities, life: 0.8, maxLife: 0.8 });
  }

  // ---- rescue ship ------------------------------------------------------
  buildRescueShip() {
    const group = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x384c5c, roughness: 0.8 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.8 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(9, 2.1, 3.6), hullMat);
    hull.position.y = 0.8;
    group.add(hull);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.5, 3.1), whiteMat);
    deck.position.y = 2.05;
    group.add(deck);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.8, 2.5), whiteMat);
    cabin.position.set(-0.5, 2.9, 0);
    group.add(cabin);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 6.5, 7), whiteMat);
    mast.position.set(1.6, 5.1, 0);
    group.add(mast);
    const light = new THREE.PointLight(0xffe3a0, 2.2, 30, 1.7);
    light.position.set(0, 4, 0);
    group.add(light);
    group.visible = false;
    group.position.set(280, 0, 40);
    this.scene.add(group);
    this.rescueShip = group;
  }

  showRescueShip() {
    this.rescueShip.visible = true;
  }

  // ---- interactions -----------------------------------------------------
  harvestTree(rec) {
    rec.alive = false;
    rec.collider.r = 0;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3(rec.pos.x, rec.pos.y, rec.pos.z);
    m4.compose(pos, q, new THREE.Vector3(rec.scale, rec.scale * 0.17, rec.scale));
    this.trunkMesh.setMatrixAt(rec.trunkIdx, m4);
    this.trunkMesh.instanceMatrix.needsUpdate = true;
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < 8; i++) {
      this.frondMesh.setMatrixAt(rec.frondStart + i, hide);
    }
    for (let i = 0; i < 2; i++) {
      this.coconutMesh.setMatrixAt(rec.coconutStart + i, hide);
    }
    this.frondMesh.instanceMatrix.needsUpdate = true;
    this.coconutMesh.instanceMatrix.needsUpdate = true;
  }

  harvestRock(rec) {
    rec.alive = false;
    rec.collider.r = 0;
    const m4 = new THREE.Matrix4().makeScale(0.22, 0.12, 0.22);
    m4.setPosition(rec.pos.x, rec.pos.y + 0.08, rec.pos.z);
    this.rockMesh.setMatrixAt(rec.rockIdx, m4);
    this.rockMesh.instanceMatrix.needsUpdate = true;
  }

  takeBranch(rec) {
    rec.alive = false;
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    this.branchMesh.setMatrixAt(rec.branchIdx, hide);
    this.branchMesh.instanceMatrix.needsUpdate = true;
  }

  openChest(rec) {
    rec.opened = true;
    this.chestLids.push({ lid: rec.lid, t: 0 });
  }

  lightBeacon() {
    this.beacon.lit = true;
    this.beacon.flame.visible = true;
    this.beacon.light.intensity = 6;
  }

  // ---- update -----------------------------------------------------------
  update(dt, elapsed, camera, env) {
    this.elapsed = elapsed;
    this.time = env.time;
    this.storm = env.storm || 0;
    this.flash = env.flash || 0;

    const sunY = Math.sin(((env.time - 6) / 24) * Math.PI * 2);
    const dayF = smoothstep(-0.14, 0.28, sunY);
    const sunsetF = clamp(1 - Math.abs(sunY) / 0.33, 0, 1) * smoothstep(-0.24, 0.0, sunY + 0.12);
    const storm = this.storm;

    const top = colorMix(this._tmpColor, PALETTE.night.top, PALETTE.day.top, dayF).lerp(PALETTE.dusk.top, sunsetF * 0.8);
    top.lerp(PALETTE.storm, storm * 0.72);
    const bottom = colorMix(this._tmpColor2, PALETTE.night.bottom, PALETTE.day.bottom, dayF).lerp(PALETTE.dusk.bottom, sunsetF * 0.85);
    bottom.lerp(PALETTE.storm, storm * 0.55);
    this.skyUniforms.topColor.value.copy(top);
    this.skyUniforms.bottomColor.value.copy(bottom);
    this.skyUniforms.storm.value = storm;
    this.skyUniforms.flash.value = this.flash;
    this.starMat.opacity = clamp(-sunY * 3.2, 0, 1) * (1 - storm) * 0.9;

    const sunDir = this._sunDir.set(
      Math.cos(((env.time - 6) / 24) * Math.PI * 2),
      sunY,
      0.34,
    ).normalize();
    this.skyUniforms.sunDir.value.copy(sunDir);

    const night = sunY < 0.02;
    const lightDir = this._lightDir.copy(night ? sunDir.clone().negate() : sunDir);
    if (night) lightDir.y = Math.max(lightDir.y, 0.15);
    lightDir.normalize();

    const playerPos = env.playerPos || camera.position;
    this.sunLight.position.copy(playerPos).addScaledVector(lightDir, 90);
    this.sunLight.target.position.copy(playerPos);
    if (night) {
      this.sunLight.color.copy(PALETTE.night.sunLight);
      this.sunLight.intensity = (0.22 + dayF * 0.3) * (1 - storm * 0.35) + this.flash * 1.2;
    } else {
      const sunColor = this._tmpColor.copy(PALETTE.day.sunLight).lerp(PALETTE.dusk.sunLight, sunsetF * 0.9);
      this.sunLight.color.copy(sunColor);
      this.sunLight.intensity = (2.25 * dayF + 0.5) * (1 - storm * 0.55) + this.flash * 1.6;
    }
    this.hemi.color.copy(this._tmpColor.copy(PALETTE.night.hemiSky).lerp(PALETTE.day.hemiSky, dayF).lerp(PALETTE.dusk.hemiSky, sunsetF));
    this.hemi.groundColor.copy(this._tmpColor2.copy(PALETTE.night.hemiGround).lerp(PALETTE.day.hemiGround, dayF));
    this.hemi.intensity = (PALETTE.night.hemiIntensity + (PALETTE.day.hemiIntensity - PALETTE.night.hemiIntensity) * dayF) * (1 - storm * 0.3);
    this.ambient.intensity = 0.1 + dayF * 0.08;

    const fogColor = colorMix(this._tmpColor, PALETTE.night.fog, PALETTE.day.fog, dayF).lerp(PALETTE.dusk.fog, sunsetF * 0.8);
    fogColor.lerp(PALETTE.storm, storm * 0.6);
    this.scene.fog.color.copy(fogColor);
    this.scene.fog.near = lerp(70, 32, storm);
    this.scene.fog.far = lerp(360, 185, storm);

    this.oceanUniforms.uTime.value = elapsed;
    this.oceanUniforms.sunDir.value.copy(lightDir);
    this.oceanUniforms.sunColor.value.copy(this.sunLight.color);
    this.oceanUniforms.deepColor.value.copy(PALETTE.night.deep).lerp(PALETTE.day.deep, dayF).lerp(PALETTE.dusk.deep, sunsetF * 0.7).lerp(PALETTE.storm, storm * 0.5);
    this.oceanUniforms.shallowColor.value.copy(PALETTE.night.shallow).lerp(PALETTE.day.shallow, dayF).lerp(PALETTE.dusk.shallow, sunsetF * 0.7).lerp(PALETTE.storm, storm * 0.4);
    this.oceanUniforms.fogColor.value.copy(fogColor);
    this.oceanUniforms.fogNear.value = this.scene.fog.near;
    this.oceanUniforms.fogFar.value = this.scene.fog.far;
    this.oceanUniforms.uStorm.value = storm;
    this.oceanUniforms.uFlash.value = this.flash;

    // sun, moon and clouds
    this.sun.position.copy(sunDir).multiplyScalar(1180);
    this.sunGlow.position.copy(this.sun.position);
    this.sun.visible = sunY > -0.08;
    this.sunGlow.visible = this.sun.visible;
    this.moon.position.copy(sunDir).multiplyScalar(-1180);
    this.moonGlow.position.copy(this.moon.position);
    this.moon.visible = sunY < 0.12;
    this.moonGlow.visible = this.moon.visible;
    this.cloudMat.color.copy(PALETTE.night.cloud).lerp(PALETTE.day.cloud, dayF).lerp(PALETTE.dusk.cloud, sunsetF * 0.8).lerp(PALETTE.storm, storm * 0.7);
    for (const cloud of this.clouds) {
      cloud.position.x += cloud.userData.speed * dt * (1 + storm * 2.4);
      if (cloud.position.x > 480) cloud.position.x = -480;
      cloud.position.y = 70 + Math.sin(elapsed * 0.12 + cloud.position.z) * 6 - storm * 18;
    }

    // foam
    for (const ring of this.foamRings) {
      ring.mesh.material.opacity = 0.08 + Math.sin(elapsed * 1.4 + ring.phase) * 0.035 + storm * 0.05;
      const s = 1 + Math.sin(elapsed * 0.8 + ring.phase) * 0.012 + storm * 0.02;
      ring.mesh.scale.set(s, 1, s);
    }

    // fire flicker
    for (const fire of this.fires) {
      for (const flame of fire.flames) {
        const ph = elapsed * 11 + flame.userData.phase;
        flame.scale.set(
          0.85 + Math.sin(ph) * 0.18,
          0.85 + Math.sin(ph * 1.37) * 0.26,
          0.85 + Math.cos(ph * 0.77) * 0.18,
        );
        flame.rotation.y += dt * 1.6;
      }
      fire.light.intensity = fire.baseIntensity * (0.78 + Math.sin(elapsed * 9 + fire.phase) * 0.1 + Math.random() * 0.08);
    }
    if (this.beacon && this.beacon.lit) {
      const f = this.beacon.flame;
      f.scale.set(1 + Math.sin(elapsed * 9) * 0.16, 1 + Math.sin(elapsed * 12) * 0.26, 1 + Math.cos(elapsed * 7) * 0.16);
      this.beacon.light.intensity = 6 * (0.8 + Math.sin(elapsed * 10) * 0.12 + Math.random() * 0.08);
    }

    // chest lids
    for (let i = this.chestLids.length - 1; i >= 0; i--) {
      const c = this.chestLids[i];
      c.t += dt;
      const k = Math.min(1, c.t / 0.45);
      c.lid.rotation.x = -1.15 * (1 - Math.pow(1 - k, 3));
      if (k >= 1) this.chestLids.splice(i, 1);
    }

    // rain
    const rainOn = storm > 0.03;
    this.rain.visible = rainOn;
    if (rainOn) {
      this.rainMat.opacity = Math.min(0.55, storm * 0.7);
      const pos = this.rain.geometry.attributes.position.array;
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      for (let i = 0; i < this.rainCount; i++) {
        const d = this.rainDrops[i];
        d.y -= d.speed * dt;
        d.x += dt * (4 + storm * 5);
        const wx = cx + d.x, wz = cz + d.z;
        if (d.y < -2 || Math.abs(d.x) > 42 || Math.abs(d.z) > 42) {
          d.x = (Math.random() - 0.5) * 76;
          d.z = (Math.random() - 0.5) * 76;
          d.y = cy + 18 + Math.random() * 26;
        }
        const idx = i * 6;
        pos[idx] = wx;
        pos[idx + 1] = d.y;
        pos[idx + 2] = wz;
        pos[idx + 3] = wx - 0.12;
        pos[idx + 4] = d.y + 0.85;
        pos[idx + 5] = wz;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }

    // particles
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      const arr = e.points.geometry.attributes.position.array;
      for (let p = 0; p < e.velocities.length / 3; p++) {
        e.velocities[p * 3 + 1] -= 9.5 * dt;
        arr[p * 3] += e.velocities[p * 3] * dt;
        arr[p * 3 + 1] += e.velocities[p * 3 + 1] * dt;
        arr[p * 3 + 2] += e.velocities[p * 3 + 2] * dt;
      }
      e.points.geometry.attributes.position.needsUpdate = true;
      e.points.material.opacity = clamp(e.life / e.maxLife, 0, 1);
      if (e.life <= 0) {
        this.scene.remove(e.points);
        e.points.geometry.dispose();
        e.points.material.dispose();
        this.effects.splice(i, 1);
      }
    }

    // raft bob / foam
    if (this.raftBuilt) {
      const bob = Math.sin(elapsed * 1.8) * 0.1 + Math.sin(elapsed * 3.3) * 0.04;
      this.raft.position.set(this.raftPos.x, 0.3 + bob, this.raftPos.z);
      this.raft.rotation.y = this.raftHeading;
      this.raft.rotation.z = Math.sin(elapsed * 1.5) * 0.035 + this.raftMoving * 0.02;
      this.raft.rotation.x = Math.cos(elapsed * 1.2) * 0.022;
      const foam = this.raft.userData.foam;
      foam.material.opacity = 0.18 + this.raftMoving * 0.2 + Math.sin(elapsed * 3) * 0.03;
      const fs = 1 + this.raftMoving * 0.15;
      foam.scale.set(fs, fs, fs);
      this.raftInteractable.pos.set(this.raftPos.x, 1.0, this.raftPos.z);
      if (this.raft.userData.sail) {
        this.raft.userData.sail.rotation.z = Math.sin(elapsed * 2.2) * 0.03 + this.raftMoving * 0.08;
      }
    }

    if (this.rescueShip.visible) {
      this.rescueShip.position.x -= dt * 5.2;
      this.rescueShip.position.y = Math.sin(elapsed * 0.9) * 0.25;
      this.rescueShip.rotation.z = Math.sin(elapsed * 0.7) * 0.025;
    }

    this.sky.position.copy(camera.position);
  }

  setRaftVisibleForCapture() {
    this.raftBuilt = true;
    this.raft.visible = true;
    this.raftSite.visible = false;
  }
}

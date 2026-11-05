// Game-wide tuning values and the archipelago layout.

export const RAFT_COST = { wood: 16, rope: 6, cloth: 2 };

export const ITEM_LABELS = {
  wood: 'Madera',
  stone: 'Piedra',
  rope: 'Cuerda',
  cloth: 'Tela',
  berries: 'Bayas',
  coconut: 'Coco',
  rawFish: 'Pescado crudo',
  cookedFish: 'Pescado asado',
  rawMeat: 'Carne cruda',
  cookedMeat: 'Carne asada',
  flare: 'Bengala',
};

export const ISLANDS = [
  {
    id: 'home',
    name: 'Isla Inicio',
    subtitle: 'Tu campamento',
    x: 0, z: 0, radius: 52, peak: 6.4, seed: 11,
    shelterAngle: 1.35,
    spawnAngle: 1.50,
    raftAngle: 0.86,
    mapColor: '#7ec96b',
    flare: false,
  },
  {
    id: 'palms',
    name: 'Atolón Palmeras',
    subtitle: 'Aguas tranquilas',
    x: 142, z: -78, radius: 40, peak: 4.3, seed: 23,
    shelterAngle: 0.55,
    mapColor: '#8fd97a',
    flare: true,
  },
  {
    id: 'rocks',
    name: 'Isla Rocosa',
    subtitle: 'Acantilados y jabalíes',
    x: -126, z: -92, radius: 44, peak: 9.6, seed: 37,
    shelterAngle: 2.25,
    mapColor: '#a9b0a0',
    flare: true,
  },
  {
    id: 'mist',
    name: 'Isla Niebla',
    subtitle: 'Selva espesa',
    x: 72, z: 152, radius: 39, peak: 7.4, seed: 51,
    shelterAngle: 3.65,
    mapColor: '#6fbf8a',
    flare: true,
  },
  {
    id: 'skull',
    name: 'Isla Calavera',
    subtitle: 'El último refugio',
    x: -150, z: 104, radius: 42, peak: 8.6, seed: 67,
    shelterAngle: 5.15,
    mapColor: '#b7a86a',
    flare: true,
  },
];

export const OUTER_ISLANDS = ISLANDS.filter(i => i.id !== 'home');

export const RECIPES = [
  {
    id: 'axe',
    name: 'Hacha de piedra',
    icon: '🪓',
    desc: 'Tala palmeras y rompe rocas mucho más rápido.',
    cost: { wood: 3, stone: 2, rope: 1 },
    once: true,
  },
  {
    id: 'spear',
    name: 'Lanza de caza',
    icon: '🔱',
    desc: 'Defiéndete de los jabalíes y consigue carne.',
    cost: { wood: 4, stone: 1, rope: 2 },
    once: true,
  },
  {
    id: 'rod',
    name: 'Caña de pescar',
    icon: '🎣',
    desc: 'Permite pescar en la orilla o desde la balsa.',
    cost: { wood: 3, rope: 2 },
    once: true,
  },
  {
    id: 'torch',
    name: 'Antorcha',
    icon: '🔥',
    desc: 'Ilumina la noche y ahuyenta la oscuridad.',
    cost: { wood: 2, cloth: 1 },
    once: true,
  },
  {
    id: 'bandage',
    name: 'Vendas',
    icon: '🩹',
    desc: 'Restaura 35 de salud al instante.',
    cost: { rope: 2, berries: 2 },
    once: false,
  },
];

// Survival tuning (units per second)
export const TUNING = {
  walkSpeed: 4.5,
  sprintSpeed: 7.4,
  swimSpeed: 2.7,
  raftSpeed: 12.5,
  hungerDrain: 0.22,
  thirstDrain: 0.30,
  staminaDrainSprint: 13,
  staminaDrainSwim: 3.4,
  staminaRegen: 10,
  nightWarmthDrain: 1.4,
  stormWarmthDrain: 5.2,
  fireWarmthGain: 12,
  shelterWarmthGain: 5,
  healthRegen: 0.28,
  hungerStarveDamage: 2.0,
  thirstDamage: 2.4,
  coldDamage: 3.4,
  dayLength: 640, // seconds for a full 24h cycle
  startHour: 8,
};

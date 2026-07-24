/**
 * The block table.
 *
 * Ore values follow the original game's escalation: each tier is worth roughly
 * enough to fund the upgrade that lets you reach the next one, so progress feels
 * like leverage rather than grinding. Depth bands overlap generously — you should
 * always be finding *something*, just not the good stuff.
 */

export const AIR = 0;
export const DIRT = 1;
export const ROCK = 2;
export const HARDROCK = 3;
export const BEDROCK = 4;
export const IRONIUM = 5;
export const BRONZIUM = 6;
export const SILVERIUM = 7;
export const GOLDIUM = 8;
export const PLATINIUM = 9;
export const EINSTEINIUM = 10;
export const EMERALD = 11;
export const RUBY = 12;
export const DIAMOND = 13;
export const AMAZONITE = 14;
export const LAVA = 15;
export const GAS = 16;

/** How a block is drawn: 0 not at all, 1 opaque, 2 translucent. */
export const RENDER_NONE = 0;
export const RENDER_OPAQUE = 1;
export const RENDER_TRANSLUCENT = 2;

/**
 * Ore definitions. `peak`/`spread` describe the depth band in metres where the ore
 * is found (a bell curve), `abundance` scales how much of that band it fills, and
 * `tile` indexes the procedural atlas built in render/materials.js.
 */
export const ORE_TABLE = [
  // Peak sits deeper than the price ladder would suggest: a band centred at 14 m
  // loses most of its bell curve to the surface, which made the cheapest ore rarer
  // than the tier above it and inverted the early economy.
  { id: IRONIUM,     key: 'ironium',     name: 'Ironium',     tile: 4,  value: 30,     hardness: 1.00, color: 0xb4643c, glow: 0xff7a3c, peak: 22,  spread: 42, abundance: 0.1750 },
  { id: BRONZIUM,    key: 'bronzium',    name: 'Bronzium',    tile: 5,  value: 60,     hardness: 1.10, color: 0xc98b3a, glow: 0xffab42, peak: 36,  spread: 44, abundance: 0.120 },
  { id: SILVERIUM,   key: 'silverium',   name: 'Silverium',   tile: 6,  value: 100,    hardness: 1.20, color: 0xd6dde4, glow: 0xdff0ff, peak: 62,  spread: 48, abundance: 0.0950 },
  { id: GOLDIUM,     key: 'goldium',     name: 'Goldium',     tile: 7,  value: 250,    hardness: 1.35, color: 0xffd447, glow: 0xffe27a, peak: 92,  spread: 52, abundance: 0.0700 },
  { id: PLATINIUM,   key: 'platinium',   name: 'Platinium',   tile: 8,  value: 750,    hardness: 1.55, color: 0xa8e6e0, glow: 0xc8fffb, peak: 122, spread: 52, abundance: 0.0480 },
  { id: EINSTEINIUM, key: 'einsteinium', name: 'Einsteinium', tile: 9,  value: 2000,   hardness: 1.80, color: 0x9cff6a, glow: 0xb6ff7a, peak: 152, spread: 50, abundance: 0.0300 },
  { id: EMERALD,     key: 'emerald',     name: 'Emerald',     tile: 10, value: 5000,   hardness: 2.00, color: 0x2ee38a, glow: 0x53ffb0, peak: 182, spread: 46, abundance: 0.0200 },
  { id: RUBY,        key: 'ruby',        name: 'Ruby',        tile: 11, value: 20000,  hardness: 2.20, color: 0xff3f5a, glow: 0xff6b80, peak: 208, spread: 40, abundance: 0.0110 },
  { id: DIAMOND,     key: 'diamond',     name: 'Diamond',     tile: 12, value: 100000, hardness: 2.60, color: 0xd8f4ff, glow: 0xffffff, peak: 232, spread: 34, abundance: 0.0060 },
  { id: AMAZONITE,   key: 'amazonite',   name: 'Amazonite',   tile: 13, value: 500000, hardness: 3.00, color: 0x5ce0c8, glow: 0x9cffee, peak: 250, spread: 22, abundance: 0.0028 },
];

function block(def) {
  return {
    value: 0,
    units: 0,
    glow: 0x000000,
    mineable: true,
    solid: true,
    render: RENDER_OPAQUE,
    hardness: 1,
    ...def,
  };
}

/** Indexed by block id. */
export const BLOCKS = [];

BLOCKS[AIR] = block({
  id: AIR, key: 'air', name: 'Open', solid: false, mineable: false,
  render: RENDER_NONE, hardness: 0, tile: 0, color: 0x000000,
});
BLOCKS[DIRT] = block({
  id: DIRT, key: 'dirt', name: 'Regolith', hardness: 0.42, tile: 0, color: 0x8a5233,
});
BLOCKS[ROCK] = block({
  id: ROCK, key: 'rock', name: 'Basalt', hardness: 0.95, tile: 1, color: 0x6a5a52,
});
BLOCKS[HARDROCK] = block({
  id: HARDROCK, key: 'hardrock', name: 'Deep Basalt', hardness: 2.05, tile: 2, color: 0x45403f,
});
BLOCKS[BEDROCK] = block({
  id: BEDROCK, key: 'bedrock', name: 'Claim Boundary', mineable: false, hardness: Infinity,
  tile: 3, color: 0x24211f,
});

for (const ore of ORE_TABLE) {
  BLOCKS[ore.id] = block({
    id: ore.id, key: ore.key, name: ore.name, hardness: ore.hardness,
    tile: ore.tile, color: ore.color, glow: ore.glow, value: ore.value, units: 1,
  });
}

// Lava is drawn as an opaque, self-lit block but you fall straight into it. That
// asymmetry is the whole hazard: it looks like rock until you are inside it.
BLOCKS[LAVA] = block({
  id: LAVA, key: 'lava', name: 'Magma', solid: false, mineable: false, hardness: Infinity,
  render: RENDER_OPAQUE, tile: 14, color: 0xff5a1e, glow: 0xff7a2a,
});
// Pressurised pockets. Harmless to look at, catastrophic to open.
BLOCKS[GAS] = block({
  id: GAS, key: 'gas', name: 'Pressurised Pocket', solid: false, mineable: false, hardness: Infinity,
  render: RENDER_TRANSLUCENT, tile: 15, color: 0x9ad84a, glow: 0x6fbe2a,
});

export const ORE_IDS = ORE_TABLE.map((o) => o.id);

export const isSolid = (id) => BLOCKS[id].solid;
export const isOpaque = (id) => BLOCKS[id].render === RENDER_OPAQUE;
export const isOre = (id) => BLOCKS[id].value > 0;
export const blockName = (id) => BLOCKS[id].name;

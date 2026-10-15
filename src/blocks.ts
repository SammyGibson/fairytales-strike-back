// Block ids are stored in a Uint8Array, so keep them below 256.
export const B = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  PATH: 4,
  LOG: 5,
  PINE: 6,
  PLANKS: 7,
  CASTLE: 8,
  SLATE: 9,
  WINDOW: 10,
  WATER: 11,
  BEDROCK: 12,
  GOO: 13,
  STEM: 14,
  CAP_PURPLE: 15,
  CAP_CYAN: 16,
  CRYSTAL: 17,
  LANTERN: 18,
  FENCE: 19,
  BANNER: 20,
  MOSSY: 21,
  SHROOM_PURPLE: 22,
  SHROOM_CYAN: 23,
} as const;

// Tile indices into the texture atlas (see textures.ts).
export const T = {
  GRASS_TOP: 0,
  GRASS_SIDE: 1,
  DIRT: 2,
  STONE: 3,
  PATH: 4,
  LOG_SIDE: 5,
  LOG_TOP: 6,
  PINE: 7,
  PLANKS: 8,
  CASTLE: 9,
  SLATE: 10,
  WINDOW: 11,
  WATER: 12,
  BEDROCK: 13,
  GOO: 14,
  STEM: 15,
  CAP_PURPLE: 16,
  CAP_CYAN: 17,
  CRYSTAL: 18,
  LANTERN: 19,
  BANNER: 20,
  MOSSY: 21,
  FENCE: 22,
} as const;

/** Non-cube blocks are drawn as one or more smaller boxes. */
export type Shape = "cube" | "fence" | "lantern" | "banner" | "shroom";

/** Light colour (0-1 per channel) and how many blocks it reaches. */
export type Light = { r: number; g: number; b: number; radius: number };

export type BlockDef = {
  name: string;
  top: number;
  side: number;
  bottom: number;
  shape: Shape;
  /** Player and enemies collide with it. */
  solid: boolean;
  /** Neighbouring faces stay visible (glass-like, leaves, water, shapes). */
  transparent: boolean;
  liquid: boolean;
  /** Glows at full brightness regardless of surroundings. */
  emissive: boolean;
  light?: Light;
};

function block(name: string, tile: number, opts: Partial<BlockDef> = {}): BlockDef {
  return {
    name,
    top: tile,
    side: tile,
    bottom: tile,
    shape: "cube",
    solid: true,
    transparent: false,
    liquid: false,
    emissive: false,
    ...opts,
  };
}

const WARM: Light = { r: 1, g: 0.62, b: 0.28, radius: 9 };
const PURPLE: Light = { r: 0.72, g: 0.28, b: 1, radius: 6 };
const CYAN: Light = { r: 0.25, g: 0.75, b: 1, radius: 6 };

export const BLOCKS: BlockDef[] = [];
BLOCKS[B.AIR] = block("Air", 0, { solid: false, transparent: true });
BLOCKS[B.GRASS] = block("Grass", T.GRASS_SIDE, { top: T.GRASS_TOP, bottom: T.DIRT });
BLOCKS[B.DIRT] = block("Dirt", T.DIRT);
BLOCKS[B.STONE] = block("Stone", T.STONE);
BLOCKS[B.PATH] = block("Path", T.PATH, { bottom: T.DIRT });
BLOCKS[B.LOG] = block("Log", T.LOG_SIDE, { top: T.LOG_TOP, bottom: T.LOG_TOP });
BLOCKS[B.PINE] = block("Pine needles", T.PINE, { transparent: true });
BLOCKS[B.PLANKS] = block("Planks", T.PLANKS);
BLOCKS[B.CASTLE] = block("Castle stone", T.CASTLE);
BLOCKS[B.SLATE] = block("Slate roof", T.SLATE);
BLOCKS[B.WINDOW] = block("Lit window", T.WINDOW, { emissive: true, light: { ...WARM, radius: 5 } });
BLOCKS[B.WATER] = block("Water", T.WATER, { solid: false, transparent: true, liquid: true });
BLOCKS[B.BEDROCK] = block("Bedrock", T.BEDROCK);
BLOCKS[B.GOO] = block("Purple goo", T.GOO, { bottom: T.DIRT, side: T.DIRT, emissive: true, light: { ...PURPLE, radius: 5 } });
BLOCKS[B.STEM] = block("Mushroom stem", T.STEM);
BLOCKS[B.CAP_PURPLE] = block("Glowcap", T.CAP_PURPLE, { emissive: true, light: PURPLE });
BLOCKS[B.CAP_CYAN] = block("Bluecap", T.CAP_CYAN, { emissive: true, light: CYAN });
BLOCKS[B.CRYSTAL] = block("Crystal", T.CRYSTAL, { emissive: true, light: { ...PURPLE, radius: 7 } });
BLOCKS[B.LANTERN] = block("Lantern", T.LANTERN, { shape: "lantern", transparent: true, emissive: true, light: WARM });
BLOCKS[B.FENCE] = block("Fence", T.FENCE, { shape: "fence", transparent: true });
BLOCKS[B.BANNER] = block("Banner", T.BANNER, { shape: "banner", transparent: true, solid: false });
BLOCKS[B.MOSSY] = block("Mossy stone", T.MOSSY);
BLOCKS[B.SHROOM_PURPLE] = block("Little glowcap", T.CAP_PURPLE, {
  shape: "shroom",
  transparent: true,
  solid: false,
  emissive: true,
  light: { ...PURPLE, radius: 4 },
});
BLOCKS[B.SHROOM_CYAN] = block("Little bluecap", T.CAP_CYAN, {
  shape: "shroom",
  transparent: true,
  solid: false,
  emissive: true,
  light: { ...CYAN, radius: 4 },
});

/** Full cubes that hide what's behind them and block light. */
export function isOpaque(id: number): boolean {
  const def = BLOCKS[id]!;
  return def.shape === "cube" && !def.transparent;
}

/** Blocks that darken nearby corners (ambient occlusion). */
export function isOccluder(id: number): boolean {
  return isOpaque(id) || id === B.PINE;
}

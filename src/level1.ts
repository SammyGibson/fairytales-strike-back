import { B } from "./blocks";
import { fbm, hash2 } from "./noise";
import { World } from "./world";

// Level 1: "Moonlit Hollow". The player starts in a village at the south end,
// follows a lantern-lit path north through a dark pine forest, and meets the
// Rotten Potato in a clearing beside a lake. A castle looms on the cliffs beyond.

export type Point = { x: number; z: number };
export type Checkpoint = { x: number; z: number; triggerZ: number };

export type Level = {
  world: World;
  name: string;
  checkpoints: Checkpoint[];
  zombies: Point[];
  boss: Point;
  arena: { x: number; z: number; r: number };
  hearts: Point[];
};

const SEED = 4242;
const GROUND = 12;
const WATER = 11;
const CLIFF_TOP = 30;
const ARENA = { x: 60, z: 38, r: 13 };
const LAKE = { x: 102, z: 40, rx: 17, rz: 14 };
const PATH_START = 123;
const PATH_END = 50;

export const pathX = (z: number) => 62 + 8 * Math.sin((120 - z) * 0.07);

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function cliffZ(x: number): number {
  return 25 + Math.round(1.5 * Math.sin(x * 0.31) + (fbm(x * 0.2, 3, SEED + 3, 2) - 0.5) * 3);
}

function lakeDist(x: number, z: number): number {
  return Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);
}

const HOUSES = [
  { x: 44, z: 106, w: 7, d: 6 },
  { x: 76, z: 102, w: 7, d: 6 },
];

function nearHouse(x: number, z: number, pad: number): boolean {
  return HOUSES.some((h) => x >= h.x - pad && x < h.x + h.w + pad && z >= h.z - pad && z < h.z + h.d + pad);
}

function terrainHeight(x: number, z: number, size: number): number {
  let h = GROUND + Math.round((fbm(x * 0.05, z * 0.05, SEED, 3) - 0.5) * 6);

  if (z >= PATH_END && z <= PATH_START + 2) {
    h = Math.round(GROUND + (h - GROUND) * smoothstep(2, 7, Math.abs(x - pathX(z))));
  }
  const da = Math.hypot(x - ARENA.x, z - ARENA.z);
  h = Math.round(GROUND + (h - GROUND) * smoothstep(ARENA.r, ARENA.r + 5, da));
  if (nearHouse(x, z, 2)) h = GROUND;

  const ld = lakeDist(x, z);
  if (ld < 1.25) h = Math.round(h + (WATER - 4 - h) * (1 - smoothstep(0.75, 1.25, ld)));

  // Hills at the world edges form a natural wall.
  const edge = Math.min(x, size - 1 - x, size - 1 - z);
  if (edge < 8) h += Math.round((8 - edge) * 1.6);

  const cz = cliffZ(x);
  if (z <= cz) h = CLIFF_TOP + Math.round(fbm(x * 0.1, z * 0.1, SEED + 9, 2) * 2);
  return Math.min(h, 44);
}

export function buildLevel1(): Level {
  const world = new World();
  const size = world.size;
  const heights = new Int16Array(size * size);
  const h = (x: number, z: number) => heights[z * size + x]!;

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const top = terrainHeight(x, z, size);
      heights[z * size + x] = top;
      const cliff = z <= cliffZ(x) + 1 && top > GROUND + 6;
      for (let y = 0; y <= Math.max(top, WATER); y++) {
        let id: number = B.AIR;
        if (y === 0) id = B.BEDROCK;
        else if (y < top - 3) id = cliff && hash2(x * 7 + y, z, SEED) < 0.3 ? B.MOSSY : B.STONE;
        else if (y < top) id = B.DIRT;
        else if (y === top) id = top < WATER ? B.DIRT : B.GRASS;
        else if (y <= WATER) id = B.WATER;
        world.set(x, y, z, id);
      }
    }
  }

  carvePath(world, h);
  buildWaterfalls(world, h);
  buildCastle(world);
  for (const house of HOUSES) buildHouse(world, house.x, house.z, house.w, house.d);
  buildVillageDecor(world, h);
  buildArena(world, h);
  plantForest(world, h);
  world.computeLighting();

  return {
    world,
    name: "Moonlit Hollow",
    checkpoints: [
      { x: pathX(118) + 0.5, z: 118.5, triggerZ: Infinity },
      { x: pathX(76) + 0.5, z: 76.5, triggerZ: 76 },
      { x: pathX(54) + 0.5, z: 54.5, triggerZ: 54 },
    ],
    zombies: [
      { x: pathX(96) + 1.5, z: 96 },
      { x: pathX(85) - 2, z: 85 },
      { x: pathX(82) + 2, z: 81 },
      { x: pathX(68) - 2, z: 68 },
      { x: pathX(65) + 2, z: 64 },
      { x: pathX(57) - 2.5, z: 57 },
      { x: pathX(55) + 2.5, z: 55 },
    ],
    boss: { x: ARENA.x + 0.5, z: ARENA.z - 5 },
    arena: ARENA,
    hearts: [
      { x: pathX(74) + 1, z: 73 },
      { x: pathX(60) - 1, z: 60 },
      { x: pathX(51) + 1, z: 51 },
    ],
  };
}

function carvePath(world: World, h: (x: number, z: number) => number): void {
  for (let z = PATH_END; z <= PATH_START; z++) {
    const cx = pathX(z);
    for (let x = Math.floor(cx - 2); x <= Math.ceil(cx + 2); x++) {
      if (Math.abs(x + 0.5 - cx) > 1.7) continue;
      const y = h(x, z);
      const goo = z < 98 && hash2(x, z, SEED + 21) < 0.05;
      world.set(x, y, z, goo ? B.GOO : B.PATH);
    }
  }
}

function lanternPost(world: World, x: number, y: number, z: number): void {
  world.set(x, y + 1, z, B.FENCE);
  world.set(x, y + 2, z, B.FENCE);
  world.set(x, y + 3, z, B.LANTERN);
}

function buildVillageDecor(world: World, h: (x: number, z: number) => number): void {
  // Lanterns along the whole path, alternating sides.
  let side = 1;
  for (let z = PATH_START - 2; z >= PATH_END + 2; z -= 7) {
    const x = Math.round(pathX(z) + side * 3);
    if (!nearHouse(x, z, 1)) lanternPost(world, x, h(x, z), z);
    side = -side;
  }

  // Fences either side of the path through the village.
  for (let z = 98; z <= PATH_START; z++) {
    for (const s of [-4, 4]) {
      const x = Math.round(pathX(z) + s);
      if (nearHouse(x, z, 1) || z % 9 === 0) continue;
      world.setIfAir(x, h(x, z) + 1, z, B.FENCE);
    }
  }

  // Banner posts at the village gate.
  for (const s of [-5, 5]) {
    const x = Math.round(pathX(97) + s);
    const y = h(x, 97);
    for (let i = 1; i <= 5; i++) world.set(x, y + i, 97, B.LOG);
    const bx = x - Math.sign(s);
    world.set(bx, y + 5, 97, B.LOG);
    world.set(bx, y + 4, 97, B.BANNER);
    world.set(bx, y + 3, 97, B.BANNER);
  }
}

function buildHouse(world: World, x0: number, z0: number, w: number, d: number): void {
  const y0 = GROUND + 1;
  const wallH = 4;
  for (let z = z0; z < z0 + d; z++) {
    for (let x = x0; x < x0 + w; x++) {
      world.set(x, GROUND, z, B.PLANKS);
      const edgeX = x === x0 || x === x0 + w - 1;
      const edgeZ = z === z0 || z === z0 + d - 1;
      if (!edgeX && !edgeZ) continue;
      for (let y = y0; y < y0 + wallH; y++) {
        const corner = edgeX && edgeZ;
        const door = z === z0 + d - 1 && x === x0 + Math.floor(w / 2) && y < y0 + 2;
        const window = !corner && y === y0 + 1 && (x - x0) % 3 === 1 && !door;
        world.set(x, y, z, door ? B.AIR : corner ? B.LOG : window ? B.WINDOW : B.PLANKS);
      }
    }
  }
  // Stepped gable roof running along x.
  const half = Math.ceil(d / 2);
  for (let i = 0; i <= half; i++) {
    const y = y0 + wallH + i;
    for (let x = x0 - 1; x <= x0 + w; x++) {
      world.set(x, y, z0 - 1 + i, B.SLATE);
      world.set(x, y, z0 + d - i, B.SLATE);
    }
    for (let z = z0 + i; z < z0 + d - i; z++) {
      world.set(x0, y, z, B.PLANKS);
      world.set(x0 + w - 1, y, z, B.PLANKS);
    }
  }
  world.set(x0 + w - 2, y0 + wallH + half + 1, z0 + 2, B.CASTLE);
  world.set(x0 + w - 2, y0 + wallH + half + 2, z0 + 2, B.CASTLE);
}

function buildArena(world: World, h: (x: number, z: number) => number): void {
  const posts = 12;
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2;
    const x = Math.round(ARENA.x + Math.cos(a) * (ARENA.r + 1));
    const z = Math.round(ARENA.z + Math.sin(a) * (ARENA.r + 1));
    if (Math.abs(x - pathX(z)) < 3 && z > ARENA.z) continue;
    lanternPost(world, x, h(x, z), z);
  }
  for (let i = 0; i < 14; i++) {
    const a = hash2(i, 1, SEED) * Math.PI * 2;
    const r = 3 + hash2(i, 2, SEED) * (ARENA.r - 4);
    const x = Math.round(ARENA.x + Math.cos(a) * r);
    const z = Math.round(ARENA.z + Math.sin(a) * r);
    world.set(x, h(x, z), z, B.GOO);
  }
}

function buildWaterfalls(world: World, h: (x: number, z: number) => number): void {
  for (const fx of [95, 96, 107]) {
    const face = cliffZ(fx);
    // A stream on the cliff top feeding the fall.
    for (let z = face - 7; z <= face; z++) {
      world.set(fx, h(fx, z), z, B.WATER);
      world.set(fx, h(fx, z) - 1, z, B.STONE);
    }
    for (let y = WATER; y < CLIFF_TOP; y++) world.setIfAir(fx, y, face + 1, B.WATER);
  }
}

function buildCastle(world: World): void {
  const y0 = CLIFF_TOP + 1;
  const fill = (x0: number, x1: number, z0: number, z1: number, y1: number, id: number) => {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) world.set(x, y, z, id);
  };
  const roof = (x0: number, x1: number, z0: number, z1: number, yStart: number) => {
    let i = 0;
    while (x0 + i <= x1 - i && z0 + i <= z1 - i && yStart + i < world.height) {
      for (let z = z0 + i; z <= z1 - i; z++)
        for (let x = x0 + i; x <= x1 - i; x++) world.set(x, yStart + i, z, B.SLATE);
      i++;
    }
  };
  const windows = (x0: number, x1: number, z: number, yFrom: number, yTo: number) => {
    for (let y = yFrom; y <= yTo; y += 3)
      for (let x = x0 + 1; x < x1; x += 2) world.set(x, y, z, B.WINDOW);
  };

  // Curtain wall with battlements.
  const wall = { x0: 42, x1: 86, z0: 8, z1: 19 };
  for (let x = wall.x0; x <= wall.x1; x++) {
    for (const z of [wall.z0, wall.z1]) {
      for (let y = y0; y <= y0 + 5; y++) world.set(x, y, z, B.CASTLE);
      if (x % 2 === 0) world.set(x, y0 + 6, z, B.CASTLE);
    }
  }
  for (let z = wall.z0; z <= wall.z1; z++) {
    for (const x of [wall.x0, wall.x1]) {
      for (let y = y0; y <= y0 + 5; y++) world.set(x, y, z, B.CASTLE);
      if (z % 2 === 0) world.set(x, y0 + 6, z, B.CASTLE);
    }
  }

  // Corner towers.
  for (const [cx, cz] of [[wall.x0, wall.z0], [wall.x1, wall.z0], [wall.x0, wall.z1], [wall.x1, wall.z1]] as const) {
    fill(cx - 2, cx + 2, cz - 2, cz + 2, y0 + 9, B.CASTLE);
    roof(cx - 3, cx + 3, cz - 3, cz + 3, y0 + 10);
    windows(cx - 2, cx + 2, cz + 3, y0 + 3, y0 + 8);
  }

  // The keep.
  fill(56, 72, 7, 16, y0 + 11, B.CASTLE);
  windows(56, 72, 17, y0 + 2, y0 + 10);
  roof(55, 73, 6, 17, y0 + 12);
  for (const [tx, tz] of [[56, 16], [72, 16], [64, 11]] as const) {
    fill(tx - 1, tx + 1, tz - 1, tz + 1, Math.min(world.height - 6, y0 + 13), B.CASTLE);
    world.set(tx, y0 + 10, tz + 2, B.WINDOW);
    roof(tx - 2, tx + 2, tz - 2, tz + 2, Math.min(world.height - 5, y0 + 14));
  }

  // Glowing crystals around the castle and along the cliff edge.
  for (let i = 0; i < 26; i++) {
    const x = 36 + Math.floor(hash2(i, 7, SEED) * 60);
    const z = Math.min(cliffZ(x) - 1, 20 + Math.floor(hash2(i, 8, SEED) * 6));
    const y = world.surfaceY(x, z) + 1;
    const tall = 1 + Math.floor(hash2(i, 9, SEED) * 3);
    for (let k = 0; k < tall; k++) world.setIfAir(x, y + k, z, B.CRYSTAL);
  }
}

function plantForest(world: World, h: (x: number, z: number) => number): void {
  const size = world.size;
  for (let z = 2; z < size - 2; z++) {
    for (let x = 2; x < size - 2; x++) {
      const y = h(x, z);
      if (world.get(x, y, z) !== B.GRASS) continue;
      const nearPath = z >= PATH_END - 2 && z <= PATH_START + 3 && Math.abs(x - pathX(z)) < 4.5;
      const inArena = Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA.r + 3;
      const castle = z < 22 && x > 36 && x < 92;
      if (nearPath || inArena || castle || nearHouse(x, z, 3) || lakeDist(x, z) < 1.1) {
        if (nearPath && Math.abs(x - pathX(z)) > 2.4 && hash2(x, z, SEED + 31) < 0.05) {
          world.setIfAir(x, y + 1, z, hash2(x, z, SEED + 32) < 0.6 ? B.SHROOM_PURPLE : B.SHROOM_CYAN);
        }
        continue;
      }
      const r = hash2(x, z, SEED + 5);
      if (r < 0.045) growPine(world, x, y + 1, z, 7 + Math.floor(hash2(x, z, SEED + 6) * 5));
      else if (r < 0.052) growBigMushroom(world, x, y + 1, z, hash2(x, z, SEED + 7) < 0.6);
      else if (r < 0.075) world.setIfAir(x, y + 1, z, hash2(x, z, SEED + 8) < 0.6 ? B.SHROOM_PURPLE : B.SHROOM_CYAN);
    }
  }
}

function growPine(world: World, x: number, y: number, z: number, height: number): void {
  const top = y + height;
  const start = y + 2;
  for (let ly = start; ly <= top; ly++) {
    const t = (ly - start) / (top - start + 1);
    const r = Math.round((1 - t) * 2.8);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) + Math.abs(dz) > r + (r > 1 ? 1 : 0)) continue;
        if ((ly - start) % 3 === 2 && Math.abs(dx) + Math.abs(dz) === r && r > 1) continue;
        world.setIfAir(x + dx, ly, z + dz, B.PINE);
      }
    }
  }
  world.setIfAir(x, top + 1, z, B.PINE);
  for (let ly = y; ly < top - 1; ly++) world.set(x, ly, z, B.LOG);
}

function growBigMushroom(world: World, x: number, y: number, z: number, purple: boolean): void {
  const stem = 3 + Math.floor(hash2(x, z, SEED + 11) * 2);
  for (let i = 0; i < stem; i++) world.set(x, y + i, z, B.STEM);
  const cap = purple ? B.CAP_PURPLE : B.CAP_CYAN;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) world.setIfAir(x + dx, y + stem, z + dz, cap);
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]] as const) world.setIfAir(x + dx, y + stem - 1, z + dz, cap);
  world.setIfAir(x, y + stem + 1, z, cap);
}

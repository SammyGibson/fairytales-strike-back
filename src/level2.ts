import { B } from "./blocks";
import type { Level } from "./levels";
import { fbm, hash2 } from "./noise";
import { World } from "./world";

// Level 2: "The Colosseum". The player starts on a column-lined road at the
// south end, walks through a tunnel under the seats and into a huge oval arena
// where Sam the Bad Man waits.

const SEED = 9191;
const GROUND = 12;
const C = { x: 64, z: 54 };
const RX = 22;
const RZ = 17;
/** Oval rings, as multiples of the arena size. */
const PODIUM = 1.08;
const SEATS = 1.6;
const OUTER = 1.72;
const SEAT_RISE = 16;
const WALL_TOP = GROUND + 25;
const ROAD_HALF = 2.5;
/** The giant door on the north side of the arena. */
const DOOR_HALF = 4;
const DOOR_HEIGHT = 9;
const DOOR_FACE_Z = Math.floor(C.z - RZ * 0.97 - 0.5) + 1;

/** 0 at the centre, 1 at the arena wall. */
function ring(x: number, z: number): number {
  return Math.hypot((x + 0.5 - C.x) / RX, (z + 0.5 - C.z) / RZ);
}

/** Position round the oval, 0-1. */
function around(x: number, z: number): number {
  return (Math.atan2((z + 0.5 - C.z) / RZ, (x + 0.5 - C.x) / RX) / (Math.PI * 2) + 1) % 1;
}

function inTunnel(x: number, z: number): boolean {
  return Math.abs(x + 0.5 - C.x) <= ROAD_HALF && z > C.z;
}

function seatTop(e: number): number {
  return GROUND + 4 + Math.floor(((e - PODIUM) / (SEATS - PODIUM)) * SEAT_RISE);
}

export function buildLevel2(): Level {
  const world = new World();
  const size = world.size;

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const edge = Math.min(x, z, size - 1 - x, size - 1 - z);
      let top = GROUND;
      if (edge < 10) top += Math.round((10 - edge) * 1.5 + fbm(x * 0.1, z * 0.1, SEED, 2) * 3);
      const e = ring(x, z);
      const plaza = e < 2.05 || (Math.abs(x + 0.5 - C.x) <= ROAD_HALF + 1 && z > C.z);
      for (let y = 0; y <= top; y++) {
        let id: number = y === 0 ? B.BEDROCK : y < top - 3 ? B.STONE : y < top ? B.DIRT : plaza ? B.SANDBRICK : B.GRASS;
        if (y === top && e < 1) id = B.SAND;
        world.set(x, y, z, id);
      }
      buildColosseumColumn(world, x, z, e);
    }
  }

  carveTunnel(world);
  buildGiantDoorway(world);
  decorateArena(world);
  buildRoad(world);
  plantTrees(world);
  world.computeLighting();

  return {
    id: 2,
    name: "The Colosseum",
    world,
    checkpoints: [
      { x: C.x + 0.5, z: 118.5, triggerZ: Infinity },
      { x: C.x + 0.5, z: C.z + RZ - 2.5, triggerZ: C.z + RZ - 1 },
    ],
    zombies: [],
    bosses: [
      { x: C.x + 0.5, z: C.z - 4, kind: "sam" },
      { x: C.x + 0.5, z: C.z - 6, kind: "bloodbox", fromDoor: true },
      { x: C.x + 0.5, z: C.z - 4, kind: "firerose", fromDoor: true, reward: "flameSword" },
    ],
    door: { x: C.x, z: DOOR_FACE_Z - 0.2, width: DOOR_HALF * 2, height: DOOR_HEIGHT, inside: { x: C.x + 0.5, z: DOOR_FACE_Z - 6 } },
    arena: { x: C.x, z: C.z, rx: RX - 1, rz: RZ - 1 },
    hearts: [
      { x: C.x - 16, z: C.z },
      { x: C.x + 16, z: C.z },
      { x: C.x - 9, z: C.z + 11 },
      { x: C.x + 9, z: C.z + 11 },
    ],
  };
}

/** The colosseum walls, seats and outer arches for one column of the world. */
function buildColosseumColumn(world: World, x: number, z: number, e: number): void {
  if (e < 1 || e >= OUTER) return;
  if (e < PODIUM) {
    // The podium wall around the arena floor.
    for (let y = GROUND + 1; y <= GROUND + 4; y++) world.set(x, y, z, B.SANDBRICK);
    return;
  }
  if (e < SEATS) {
    // Rising tiers of seats, striped in two stones.
    const top = seatTop(e);
    const step = top - (GROUND + 4);
    for (let y = GROUND + 1; y <= top; y++) world.set(x, y, z, y === top && step % 2 ? B.SANDBRICK : B.SANDSTONE);
    return;
  }
  // The outer wall: three storeys of arches with a terracotta trim.
  const t = (around(x, z) * 52) % 1;
  for (let y = GROUND + 1; y <= WALL_TOP; y++) {
    const storey = Math.floor((y - GROUND - 1) / 8);
    const inStorey = (y - GROUND - 1) % 8;
    const arch = storey < 3 && inStorey >= 1 && inStorey <= 5 && t > 0.28 && t < 0.72 && (inStorey < 5 || (t > 0.38 && t < 0.62));
    if (arch) continue;
    world.set(x, y, z, inStorey === 7 ? B.TERRACOTTA : B.SANDBRICK);
  }
  if (Math.floor(around(x, z) * 104) % 2 === 0) world.set(x, WALL_TOP + 1, z, B.SANDBRICK);
}

function carveTunnel(world: World): void {
  for (let z = C.z; z < world.size; z++) {
    for (let x = Math.floor(C.x - ROAD_HALF - 1); x <= Math.ceil(C.x + ROAD_HALF + 1); x++) {
      const e = ring(x, z);
      if (!inTunnel(x, z) || e < 0.98 || e >= OUTER + 0.02) continue;
      for (let y = GROUND + 1; y <= GROUND + 5; y++) world.set(x, y, z, B.AIR);
      world.set(x, GROUND, z, B.SANDBRICK);
      // A roof where the seats above are too low to cover the tunnel.
      if (e >= PODIUM && world.get(x, GROUND + 6, z) === B.AIR) world.set(x, GROUND + 6, z, B.SANDBRICK);
    }
  }
  // Lanterns along the tunnel walls.
  for (let z = C.z + RZ + 1; z < C.z + RZ * OUTER; z += 3) {
    for (const x of [Math.floor(C.x - ROAD_HALF - 0.5), Math.ceil(C.x + ROAD_HALF - 0.5)]) {
      if (world.get(x, GROUND + 3, z) === B.AIR) world.set(x, GROUND + 3, z, B.LANTERN);
    }
  }
}

/** A tall gatehouse in the north wall with a dark tunnel behind the giant door. */
function buildGiantDoorway(world: World): void {
  const inGate = (x: number) => Math.abs(x + 0.5 - C.x) <= DOOR_HALF;
  for (let z = 0; z < C.z; z++) {
    for (let x = Math.floor(C.x - DOOR_HALF - 4); x <= Math.ceil(C.x + DOOR_HALF + 4); x++) {
      const e = ring(x, z);
      // Gatehouse wall around the door.
      if (e >= 0.97 && e < PODIUM + 0.06 && Math.abs(x + 0.5 - C.x) <= DOOR_HALF + 2.5) {
        for (let y = GROUND + 1; y <= GROUND + DOOR_HEIGHT + 3; y++) world.set(x, y, z, y === GROUND + DOOR_HEIGHT + 3 ? B.TERRACOTTA : B.SANDBRICK);
      }
      // The tunnel behind the door.
      if (inGate(x) && z <= DOOR_FACE_Z - 1 && z >= DOOR_FACE_Z - 9) {
        for (let y = GROUND + 1; y <= GROUND + DOOR_HEIGHT; y++) world.set(x, y, z, B.AIR);
        world.set(x, GROUND, z, B.SANDBRICK);
        if (world.get(x, GROUND + DOOR_HEIGHT + 1, z) === B.AIR) world.set(x, GROUND + DOOR_HEIGHT + 1, z, B.SANDBRICK);
      }
    }
  }
  // Back wall and sides of the tunnel, so it's a closed room.
  for (let y = GROUND + 1; y <= GROUND + DOOR_HEIGHT + 1; y++) {
    for (let x = Math.floor(C.x - DOOR_HALF - 1); x <= Math.ceil(C.x + DOOR_HALF); x++) world.set(x, y, DOOR_FACE_Z - 10, B.SANDBRICK);
    for (let z = DOOR_FACE_Z - 10; z < DOOR_FACE_Z; z++) {
      world.set(Math.floor(C.x - DOOR_HALF - 0.5) - 1, y, z, B.SANDBRICK);
      world.set(Math.ceil(C.x + DOOR_HALF - 0.5) + 1, y, z, B.SANDBRICK);
    }
  }
  // An eerie purple glow inside, and lanterns and banners either side of the door.
  for (const x of [Math.floor(C.x - DOOR_HALF + 0.5), Math.floor(C.x + DOOR_HALF - 0.5)]) {
    world.set(x, GROUND + 1, DOOR_FACE_Z - 9, B.CRYSTAL);
    world.set(x, GROUND + 2, DOOR_FACE_Z - 9, B.CRYSTAL);
  }
  world.set(Math.floor(C.x), GROUND, DOOR_FACE_Z - 5, B.GOO);
  for (const side of [-1, 1]) {
    const x = Math.floor(C.x + side * (DOOR_HALF + 1.5));
    const z = DOOR_FACE_Z;
    world.set(x, GROUND + 1, z, B.FENCE);
    world.set(x, GROUND + 2, z, B.FENCE);
    world.set(x, GROUND + 3, z, B.LANTERN);
    world.set(x, GROUND + 7, z, B.BANNER);
    world.set(x, GROUND + 6, z, B.BANNER);
  }
}

function decorateArena(world: World): void {
  // Lanterns along the top of the podium wall.
  const posts = 36;
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2;
    const x = Math.floor(C.x + Math.cos(a) * RX * 1.04);
    const z = Math.floor(C.z + Math.sin(a) * RZ * 1.04);
    if (inTunnel(x, z)) continue;
    if (world.get(x, GROUND + 4, z) === B.SANDBRICK) world.set(x, GROUND + 5, z, B.LANTERN);
  }

  // Red banners hanging on the north and south faces of the podium wall.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    if (Math.abs(Math.sin(a)) < 0.75) continue;
    const x = Math.floor(C.x + Math.cos(a) * RX * 0.985);
    const z = Math.floor(C.z + Math.sin(a) * RZ * 0.985);
    if (inTunnel(x, z) || world.get(x, GROUND + 4, z) !== B.AIR) continue;
    world.set(x, GROUND + 4, z, B.BANNER);
    world.set(x, GROUND + 3, z, B.BANNER);
  }

  // Lanterns glowing in some of the outer arches.
  for (let i = 0; i < 52; i += 2) {
    const a = ((i + 0.5) / 52) * Math.PI * 2;
    const x = Math.floor(C.x + Math.cos(a) * RX * 1.66);
    const z = Math.floor(C.z + Math.sin(a) * RZ * 1.66);
    for (const y of [GROUND + 2, GROUND + 10, GROUND + 18]) {
      if (world.get(x, y, z) === B.AIR && world.get(x, y - 1, z) !== B.AIR) world.set(x, y, z, B.LANTERN);
    }
  }

  // Purple crystals among the seats and goo puddles near the arena edge.
  for (let i = 0; i < 22; i++) {
    const a = hash2(i, 1, SEED) * Math.PI * 2;
    const e = 1.2 + hash2(i, 2, SEED) * 0.3;
    const x = Math.floor(C.x + Math.cos(a) * RX * e);
    const z = Math.floor(C.z + Math.sin(a) * RZ * e);
    if (inTunnel(x, z)) continue;
    const y = seatTop(ring(x, z)) + 1;
    for (let k = 0; k < 1 + Math.floor(hash2(i, 3, SEED) * 2); k++) world.setIfAir(x, y + k, z, B.CRYSTAL);
  }
  for (let i = 0; i < 18; i++) {
    const a = hash2(i, 4, SEED) * Math.PI * 2;
    const e = 0.55 + hash2(i, 5, SEED) * 0.35;
    const x = Math.floor(C.x + Math.cos(a) * RX * e);
    const z = Math.floor(C.z + Math.sin(a) * RZ * e);
    world.set(x, GROUND, z, B.GOO);
  }
}

function buildRoad(world: World): void {
  const start = Math.ceil(C.z + RZ * OUTER);
  for (let z = start; z < world.size - 4; z++) {
    for (let x = Math.floor(C.x - ROAD_HALF); x <= Math.ceil(C.x + ROAD_HALF); x++) {
      if (Math.abs(x + 0.5 - C.x) <= ROAD_HALF) world.set(x, world.surfaceY(x, z), z, B.SANDBRICK);
    }
  }
  // Columns with lanterns on top, both sides of the road.
  for (let z = start + 3; z < world.size - 8; z += 6) {
    for (const x of [Math.floor(C.x - ROAD_HALF - 2), Math.ceil(C.x + ROAD_HALF + 1)]) {
      const y = world.surfaceY(x, z) + 1;
      for (let k = 0; k < 5; k++) world.set(x, y + k, z, B.PILLAR);
      world.set(x, y + 5, z, B.SANDSTONE);
      world.set(x, y + 6, z, B.LANTERN);
    }
  }
}

function plantTrees(world: World): void {
  for (let z = 3; z < world.size - 3; z++) {
    for (let x = 3; x < world.size - 3; x++) {
      if (ring(x, z) < 2.25 || Math.abs(x + 0.5 - C.x) < ROAD_HALF + 5) continue;
      const y = world.surfaceY(x, z);
      if (world.get(x, y, z) !== B.GRASS) continue;
      const r = hash2(x, z, SEED + 5);
      if (r < 0.04) growCypress(world, x, y + 1, z, 6 + Math.floor(hash2(x, z, SEED + 6) * 5));
      else if (r < 0.06) world.setIfAir(x, y + 1, z, hash2(x, z, SEED + 7) < 0.6 ? B.SHROOM_PURPLE : B.SHROOM_CYAN);
    }
  }
}

/** Tall, narrow Roman cypress trees. */
function growCypress(world: World, x: number, y: number, z: number, height: number): void {
  for (let i = 0; i < 2; i++) world.set(x, y + i, z, B.LOG);
  for (let ly = y + 1; ly <= y + height; ly++) {
    const r = ly < y + height - 1 && ly > y + 1 ? 1 : 0;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) + Math.abs(dz) > 1) continue;
        world.setIfAir(x + dx, ly, z + dz, B.PINE);
      }
    }
  }
  world.setIfAir(x, y + height + 1, z, B.PINE);
}

import { BoxGeometry, Group, Mesh, MeshBasicMaterial, type Texture } from "three";
import { pixelTexture, type RGB } from "./textures";

// Blocky character models built from boxes with little pixel textures.
// Each model lists its "lit" materials so the game can tint them to match
// the light where the character stands, and its "glow" materials (eyes etc.).

export type Model = {
  group: Group;
  lit: MeshBasicMaterial[];
  glow: MeshBasicMaterial[];
};

const geoCache = new Map<string, BoxGeometry>();
function boxGeo(w: number, h: number, d: number): BoxGeometry {
  const key = `${w},${h},${d}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new BoxGeometry(w, h, d);
    geoCache.set(key, g);
  }
  return g;
}

function part(parent: Group, w: number, h: number, d: number, mat: MeshBasicMaterial, x: number, y: number, z: number): Mesh {
  const mesh = new Mesh(boxGeo(w, h, d), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function litMat(map: Texture | null, model: Model, color = 0xffffff): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ map, color, alphaTest: map ? 0.5 : 0 });
  // The game multiplies this base colour by the light where the character stands.
  m.userData["base"] = m.color.clone();
  model.lit.push(m);
  return m;
}

function glowMat(r: number, g: number, b: number, model: Model): MeshBasicMaterial {
  const m = new MeshBasicMaterial();
  m.color.setRGB(r, g, b);
  model.glow.push(m);
  return m;
}

const noise = (base: RGB, amount: number, rand: () => number): RGB => {
  const f = 1 + (rand() - 0.5) * amount;
  return [base[0] * f, base[1] * f, base[2] * f];
};

let textures: ReturnType<typeof makeTextures> | null = null;
function tex() {
  textures ??= makeTextures();
  return textures;
}

function makeTextures() {
  const PURPLE: RGB = [138, 44, 178];
  return {
    zHead: pixelTexture(8, 8, 1, (_x, y, r) => noise(y < 2 ? [58, 50, 66] : [36, 30, 44], 0.4, r)),
    zTorso: pixelTexture(8, 8, 2, (x, y, r) => {
      if (y === 7 && r() < 0.5) return null;
      if ((x * 3 + y * 5) % 11 === 0 || (y > 4 && r() < 0.25)) return noise(PURPLE, 0.3, r);
      return noise([214, 208, 216], 0.18, r);
    }),
    zArm: pixelTexture(4, 12, 3, (x, y, r) => (y < 6 + (x % 2) ? noise([220, 214, 222], 0.15, r) : noise(PURPLE, 0.3, r))),
    zLeg: pixelTexture(4, 8, 4, (_x, _y, r) => noise([118, 36, 156], 0.35, r)),
    potato: pixelTexture(16, 16, 5, (x, y, r) => {
      if (r() < 0.07) return noise([110, 74, 40], 0.3, r);
      if ((x + Math.floor(y / 3)) % 7 === 0 && y > 5) return noise([186, 196, 70], 0.2, r);
      return noise([206, 170, 108], 0.2, r);
    }),
    lump: pixelTexture(8, 8, 6, (_x, _y, r) => noise([120, 82, 48], 0.35, r)),
    dirtyPotato: pixelTexture(8, 8, 7, (_x, _y, r) => (r() < 0.3 ? noise([88, 62, 40], 0.3, r) : noise([170, 132, 80], 0.25, r))),
    stone: pixelTexture(8, 8, 9, (_x, _y, r) => (r() < 0.2 ? noise([92, 128, 80], 0.3, r) : noise([168, 166, 176], 0.25, r))),
    bark: pixelTexture(8, 8, 10, (x, _y, r) => noise([98, 72, 48], (x % 3 === 0 ? 0.5 : 0.2), r)),
    cream: pixelTexture(8, 8, 11, (_x, _y, r) => (r() < 0.06 ? noise([96, 140, 60], 0.3, r) : noise([228, 216, 186], 0.12, r))),
    moss: pixelTexture(8, 8, 12, (_x, _y, r) => noise(r() < 0.3 ? [120, 170, 50] : [58, 104, 40], 0.35, r)),
    mossyLeg: pixelTexture(8, 8, 13, (_x, _y, r) => (r() < 0.35 ? noise([70, 110, 44], 0.3, r) : noise([56, 50, 44], 0.3, r))),
    boot: pixelTexture(8, 8, 14, (_x, y, r) => noise(y > 5 ? [140, 30, 30] : [196, 44, 40], 0.15, r)),
    jelly: pixelTexture(16, 16, 15, (x, y, r) => {
      const v = r();
      if (v < 0.12) return noise([240, 80, 90], 0.15, r);
      if (v < 0.3) return noise([130, 16, 28], 0.2, r);
      return noise((x + y) % 5 === 0 ? [170, 24, 36] : [200, 40, 52], 0.15, r);
    }),
    hair: pixelTexture(8, 8, 17, (x, _y, r) => noise(x % 3 === 0 ? [176, 30, 36] : [232, 58, 46], 0.18, r)),
    skin: pixelTexture(8, 8, 18, (_x, _y, r) => noise([158, 104, 70], 0.06, r)),
    bodice: pixelTexture(8, 8, 19, (x, y, r) => ((x + y * 3) % 5 === 0 ? noise([250, 200, 80], 0.1, r) : noise([214, 70, 34], 0.15, r))),
    doorWood: pixelTexture(8, 16, 16, (x, _y, r) => noise([88, 58, 36], x % 4 === 0 ? 0.55 : 0.2, r)),
    shield: pixelTexture(12, 14, 8, (x, y, r) => {
      if (x === 0 || x === 11 || y === 0 || y === 13) return noise([150, 150, 162], 0.12, r);
      const emblem = (Math.abs(x - 5.5) < 1.2 && y > 2 && y < 11) || (Math.abs(y - 5.5) < 1.2 && x > 1 && x < 10);
      if (emblem) return noise([196, 44, 48], 0.12, r);
      return noise([128, 88, 54], (x % 4 === 0 ? 0.6 : 0.18), r);
    }),
  };
}

// ---------- Purple Zombie ----------

export type ZombieModel = Model & {
  leftArm: Group;
  rightArm: Group;
  leftLeg: Group;
  rightLeg: Group;
  body: Group;
};

export function makeZombie(): ZombieModel {
  const t = tex();
  const model = { group: new Group(), lit: [], glow: [] } as unknown as ZombieModel;
  const body = new Group();
  model.group.add(body);
  model.body = body;

  const legMat = litMat(t.zLeg, model);
  const limb = (x: number, y: number) => {
    const g = new Group();
    g.position.set(x, y, 0);
    body.add(g);
    return g;
  };
  model.leftLeg = limb(-0.17, 0.75);
  model.rightLeg = limb(0.17, 0.75);
  part(model.leftLeg, 0.3, 0.75, 0.3, legMat, 0, -0.375, 0);
  part(model.rightLeg, 0.3, 0.75, 0.3, legMat, 0, -0.375, 0);

  part(body, 0.74, 0.72, 0.42, litMat(t.zTorso, model), 0, 1.11, 0);
  part(body, 0.72, 0.72, 0.72, litMat(t.zHead, model), 0, 1.83, 0);

  const eye = glowMat(3.2, 0.9, 5, model);
  part(body, 0.17, 0.08, 0.04, eye, -0.16, 1.86, 0.37);
  part(body, 0.17, 0.08, 0.04, eye, 0.16, 1.86, 0.37);

  const armMat = litMat(t.zArm, model);
  model.leftArm = limb(-0.5, 1.42);
  model.rightArm = limb(0.5, 1.42);
  part(model.leftArm, 0.26, 0.95, 0.26, armMat, 0, -0.42, 0);
  part(model.rightArm, 0.26, 0.95, 0.26, armMat, 0, -0.42, 0);
  return model;
}

// ---------- The Rotten Potato ----------

export type PotatoModel = Model & { body: Group };

export function makePotatoBoss(): PotatoModel {
  const t = tex();
  const model = { group: new Group(), lit: [], glow: [] } as unknown as PotatoModel;
  const body = new Group();
  model.group.add(body);
  model.body = body;

  const skin = litMat(t.potato, model);
  const lump = litMat(t.lump, model);
  const dark = litMat(null, model, 0x3a2418);
  const fang = litMat(null, model, 0xf2ecd8);
  const slime = glowMat(0.9, 1.1, 0.25, model);

  // A lumpy mound, widest at the bottom.
  const layers: [number, number, number, number][] = [
    [5.2, 1.3, 4.6, 0.65],
    [4.4, 1.3, 3.9, 1.95],
    [3.6, 1.2, 3.2, 3.2],
    [2.6, 0.9, 2.4, 4.25],
  ];
  for (const [w, h, d, y] of layers) part(body, w, h, d, skin, 0, y, 0);
  for (const [x, y, z, s] of [
    [-2.1, 1.2, 1.6, 0.8], [2.2, 0.9, -1.2, 0.9], [-1.6, 2.6, -1.4, 0.7], [1.5, 3.4, 1.0, 0.6],
    [0.4, 4.8, -0.3, 0.7], [-2.4, 0.5, -1.8, 0.7], [1.9, 2.3, 1.6, 0.6],
  ] as const) {
    part(body, s, s, s, lump, x, y, z);
  }
  for (const [x, z, h] of [[-1.8, 2.31, 0.9], [0.9, 2.31, 0.6], [2.2, 1.0, 0.8], [-2.2, -0.6, 0.7]] as const) {
    part(body, 0.16, h, 0.08, slime, x, 1.3 - h / 2 + 0.6, z);
  }

  // Angry face.
  const eye = glowMat(3.4, 3, 0.6, model);
  part(body, 0.42, 0.3, 0.1, eye, -0.7, 3.3, 1.62);
  part(body, 0.42, 0.3, 0.1, eye, 0.7, 3.3, 1.62);
  const browL = part(body, 0.85, 0.22, 0.14, dark, -0.72, 3.66, 1.66);
  browL.rotation.z = -0.38;
  const browR = part(body, 0.85, 0.22, 0.14, dark, 0.72, 3.66, 1.66);
  browR.rotation.z = 0.38;
  part(body, 1.7, 0.55, 0.12, dark, 0, 2.45, 1.97);
  part(body, 0.2, 0.42, 0.14, fang, -0.52, 2.5, 2.0);
  part(body, 0.2, 0.42, 0.14, fang, 0.52, 2.5, 2.0);

  // Claws.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      part(body, 0.24, 0.42, 0.5, dark, side * (1.1 + i * 0.36), 0.22, 2.45);
    }
  }
  return model;
}

/** Little rotten potatoes that sit around the boss and puff stink clouds. */
export function makeRottenSpud(): Model {
  const model: Model = { group: new Group(), lit: [], glow: [] };
  part(model.group, 0.6, 0.48, 0.52, litMat(tex().dirtyPotato, model), 0, 0.24, 0);
  return model;
}

/** A big boulder the boss lifts and throws. */
export function makeStone(): Model {
  const model: Model = { group: new Group(), lit: [], glow: [] };
  const rock = litMat(tex().stone, model);
  part(model.group, 0.8, 0.7, 0.75, rock, 0, 0, 0);
  part(model.group, 0.5, 0.4, 0.5, rock, 0.25, 0.3, -0.15);
  part(model.group, 0.45, 0.45, 0.4, rock, -0.28, -0.12, 0.25);
  return model;
}

// ---------- Sam the Bad Man ----------

export type SamArm = { pivot: Group; side: number; lift: number; hand: Mesh };
export type SamModel = Model & { body: Group; leftLeg: Group; rightLeg: Group; arms: SamArm[]; handGlow: MeshBasicMaterial };

export function makeSam(): SamModel {
  const t = tex();
  const model = { group: new Group(), lit: [], glow: [] } as unknown as SamModel;
  const body = new Group();
  model.group.add(body);
  model.body = body;

  const bark = litMat(t.bark, model);
  const cream = litMat(t.cream, model);
  const moss = litMat(t.moss, model);
  const legMat = litMat(t.mossyLeg, model);
  const boot = litMat(t.boot, model);
  const dark = litMat(null, model, 0x2a1c14);
  const fang = litMat(null, model, 0xf4eee0);
  const tongue = litMat(null, model, 0xc2304a);
  const slime = glowMat(0.6, 1.4, 0.18, model);
  model.handGlow = glowMat(1.2, 3, 0.4, model);

  const leg = (x: number) => {
    const g = new Group();
    g.position.set(x, 2.9, 0);
    body.add(g);
    part(g, 0.95, 2.0, 0.95, legMat, 0, -1.0, 0);
    part(g, 1.15, 0.9, 1.45, boot, 0, -2.45, 0.15);
    return g;
  };
  model.leftLeg = leg(-0.75);
  model.rightLeg = leg(0.75);

  // Torso with a glowing green zigzag, and mossy shoulders.
  part(body, 2.4, 2.4, 1.4, cream, 0, 4.1, 0);
  for (const [x, y, r] of [[-0.5, 4.6, -0.7], [0.1, 4.1, 0.7], [0.5, 3.6, -0.7]] as const) {
    const zig = part(body, 1.1, 0.22, 0.06, slime, x, y, 0.72);
    zig.rotation.z = r;
  }
  for (const side of [-1, 1]) part(body, 0.9, 0.7, 1.2, moss, side * 1.1, 5.25, 0);

  // Square head with an angry face.
  part(body, 1.8, 1.8, 1.8, cream, 0, 6.2, 0);
  const eye = glowMat(1.4, 4, 0.6, model);
  part(body, 0.34, 0.24, 0.08, eye, -0.42, 6.45, 0.92);
  part(body, 0.34, 0.24, 0.08, eye, 0.42, 6.45, 0.92);
  const browL = part(body, 0.62, 0.16, 0.12, dark, -0.42, 6.74, 0.94);
  browL.rotation.z = -0.4;
  const browR = part(body, 0.62, 0.16, 0.12, dark, 0.42, 6.74, 0.94);
  browR.rotation.z = 0.4;
  part(body, 0.9, 0.45, 0.1, dark, 0, 5.85, 0.92);
  part(body, 0.34, 0.36, 0.1, tongue, 0, 5.7, 0.96);
  for (const x of [-0.36, 0.36]) part(body, 0.12, 0.28, 0.12, fang, x, 5.95, 0.98);
  for (const x of [-0.18, 0.18]) part(body, 0.1, 0.2, 0.12, fang, x, 5.75, 0.98);

  // Wild mossy hair.
  for (const [x, y, z, sz] of [
    [0, 7.3, 0, 1.2], [-0.7, 7.15, 0.3, 0.7], [0.7, 7.2, -0.2, 0.8], [-0.3, 7.6, -0.4, 0.6], [0.4, 7.7, 0.3, 0.5],
    [-1.0, 6.6, -0.3, 0.6], [1.0, 6.7, 0.2, 0.6], [0, 7.0, -0.9, 0.9],
  ] as const) {
    part(body, sz, sz, sz, moss, x, y, z);
  }
  for (const [x, z] of [[-0.6, 0.85], [0.75, 0.6], [-0.9, -0.2]] as const) part(body, 0.12, 0.5, 0.12, slime, x, 6.85, z);

  // Six long branch arms, three on each side.
  model.arms = [];
  for (const side of [-1, 1]) {
    for (const [y, lift] of [[5.1, 0.75], [4.5, 0.2], [3.8, -0.35]] as const) {
      const pivot = new Group();
      pivot.position.set(side * 1.15, y, 0);
      body.add(pivot);
      part(pivot, 2.5, 0.42, 0.42, bark, side * 1.25, 0, 0);
      part(pivot, 0.6, 0.5, 0.6, moss, side * 0.9, 0.12, 0);
      const hand = part(pivot, 0.72, 0.72, 0.72, model.handGlow, side * 2.75, 0, 0);
      part(pivot, 0.14, 0.45, 0.14, slime, side * 2.6, -0.5, 0.1);
      model.arms.push({ pivot, side, lift, hand });
    }
  }
  return model;
}

export function makeFireball(): Model {
  const model: Model = { group: new Group(), lit: [], glow: [] };
  part(model.group, 0.56, 0.56, 0.56, glowMat(4, 1.3, 0.2, model), 0, 0, 0);
  const core = part(model.group, 0.34, 0.34, 0.34, glowMat(5, 4, 1.4, model), 0, 0, 0);
  core.rotation.set(0.6, 0.6, 0);
  return model;
}

// ---------- The Blood Box ----------

export type BloodBoxModel = Model & { body: Group; orbit: Group; tentacles: Group[] };

export function makeBloodBox(): BloodBoxModel {
  const t = tex();
  const model = { group: new Group(), lit: [], glow: [] } as unknown as BloodBoxModel;
  const body = new Group();
  model.group.add(body);
  model.body = body;

  const jelly = litMat(t.jelly, model);
  const dark = litMat(null, model, 0x2a0a0e);
  const fang = litMat(null, model, 0xf2e6d6);
  const goo = glowMat(2.2, 0.25, 0.3, model);
  const eye = glowMat(4.5, 0.6, 0.6, model);

  // The big jelly cube, with lumpy cubes on top.
  part(body, 4.4, 4.4, 4.4, jelly, 0, 2.4, 0);
  for (const [x, z, sz] of [[-1.4, -1.2, 1.1], [1.2, -0.6, 0.9], [0.1, 1.0, 1.0], [-0.4, -0.2, 0.8], [1.6, 1.4, 0.7]] as const) {
    part(body, sz, sz, sz, jelly, x, 4.6 + sz / 2, z);
  }

  // Angry face: brows, glowing eyes with goo running down, fanged mouth.
  for (const side of [-1, 1]) {
    const brow = part(body, 1.4, 0.32, 0.2, dark, side * 1.0, 3.7, 2.25);
    brow.rotation.z = side * 0.35;
    part(body, 0.62, 0.42, 0.12, eye, side * 1.0, 3.25, 2.24);
    part(body, 0.2, 1.2, 0.1, goo, side * 1.05, 2.5, 2.26);
  }
  part(body, 2.0, 1.0, 0.14, dark, 0, 1.75, 2.24);
  for (const x of [-0.75, -0.25, 0.25, 0.75]) part(body, 0.22, 0.36, 0.16, fang, x, 2.07, 2.27);
  part(body, 0.6, 1.4, 0.16, goo, 0, 0.95, 2.28);
  for (const [x, z, h] of [[-2.21, 1.2, 1.4], [2.21, -0.5, 1.1], [-2.21, -1.4, 0.9], [1.4, 2.21, 1.0]] as const) {
    part(body, Math.abs(x) > 2 ? 0.1 : 0.2, h, Math.abs(z) > 2 ? 0.1 : 0.2, goo, x, 1.6, z);
  }

  // Cube tentacles curling out of each side, with cubes dangling off them.
  model.tentacles = [];
  for (const side of [-1, 1]) {
    const arm = new Group();
    arm.position.set(side * 2.2, 2.6, 0.4);
    body.add(arm);
    let x = 0;
    let y = 0;
    [1.0, 0.85, 0.75, 0.65, 0.55].forEach((sz, i) => {
      x += side * sz * 0.95;
      y += i < 2 ? 0.35 : -0.5;
      part(arm, sz, sz, sz, jelly, x, y, 0);
      if (i % 2 === 1) part(arm, 0.3, 0.3, 0.3, jelly, x, y - sz, 0.1);
    });
    model.tentacles.push(arm);
  }

  // Little cubes floating around its head (these become the Cube Rain).
  model.orbit = new Group();
  model.orbit.position.y = 5.6;
  body.add(model.orbit);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const c = part(model.orbit, 0.55, 0.55, 0.55, jelly, Math.cos(a) * 3, Math.sin(i * 1.7) * 0.6, Math.sin(a) * 3);
    c.rotation.set(i, i * 0.5, 0);
  }
  return model;
}

/** Small hopping jelly cubes the Blood Box spits out. */
export function makeMiniBox(): Model {
  const model: Model = { group: new Group(), lit: [], glow: [] };
  part(model.group, 0.8, 0.8, 0.8, litMat(tex().jelly, model), 0, 0.4, 0);
  const eye = glowMat(4, 0.5, 0.5, model);
  part(model.group, 0.16, 0.12, 0.04, eye, -0.18, 0.55, 0.41);
  part(model.group, 0.16, 0.12, 0.04, eye, 0.18, 0.55, 0.41);
  part(model.group, 0.4, 0.14, 0.04, litMat(null, model, 0x2a0a0e), 0, 0.3, 0.41);
  return model;
}

/** A falling cube for the Cube Rain. */
export function makeFallingCube(): Model {
  const model: Model = { group: new Group(), lit: [], glow: [] };
  part(model.group, 0.9, 0.9, 0.9, litMat(tex().jelly, model), 0, 0, 0);
  return model;
}

/** A glowing square on the ground showing where something will land. */
export function makeMarker(size: number, color: [number, number, number] = [2.4, 0.3, 0.35]): Model {
  const model: Model = { group: new Group(), lit: [], glow: [] };
  const mat = glowMat(color[0], color[1], color[2], model);
  mat.transparent = true;
  mat.opacity = 0.75;
  part(model.group, size, 0.06, size, mat, 0, 0.04, 0);
  return model;
}

/** The expanding goo ring from the Jelly Slam, built from a circle of cubes. */
export function makeShockwave(color: [number, number, number] = [2.6, 0.35, 0.4]): Model & { pieces: Mesh[] } {
  const model = { group: new Group(), lit: [], glow: [], pieces: [] as Mesh[] };
  const mat = glowMat(color[0], color[1], color[2], model);
  for (let i = 0; i < 40; i++) model.pieces.push(part(model.group, 0.45, 0.35, 0.45, mat, 0, 0.2, 0));
  return model;
}

// ---------- Fire Rose ----------

export type FireRoseModel = Model & { body: Group; roses: Group; dress: MeshBasicMaterial[] };

/** A little blocky rose: dark petals round a glowing heart. */
function addRose(model: Model, parent: Group, x: number, y: number, z: number, s: number): Group {
  const t = tex();
  const rose = new Group();
  rose.position.set(x, y, z);
  parent.add(rose);
  const petal = litMat(t.hair, model);
  part(rose, 0.42 * s, 0.42 * s, 0.42 * s, petal, 0, 0, 0);
  for (const [dx, dy, dz] of [[0.22, 0.1, 0], [-0.22, 0.05, 0.05], [0, 0.12, 0.22], [0.05, -0.08, -0.22]] as const) {
    part(rose, 0.28 * s, 0.26 * s, 0.28 * s, petal, dx * s, dy * s, dz * s);
  }
  part(rose, 0.16 * s, 0.16 * s, 0.16 * s, glowMat(3, 1, 0.3, model), 0, 0.2 * s, 0);
  return rose;
}

export function makeFireRose(): FireRoseModel {
  const t = tex();
  const model = { group: new Group(), lit: [], glow: [] } as unknown as FireRoseModel;
  const body = new Group();
  model.group.add(body);
  model.body = body;

  const hair = litMat(t.hair, model);
  const skin = litMat(t.skin, model);
  const bodice = litMat(t.bodice, model);
  const legs = litMat(null, model, 0x3a2626);
  const shoe = litMat(null, model, 0xb3242c);
  const black = litMat(null, model, 0x120a0c);
  const white = litMat(null, model, 0xffffff);
  const rim = litMat(null, model, 0x6e1622);
  const lips = litMat(null, model, 0xd0303c);

  // Legs and red shoes.
  for (const side of [-1, 1]) {
    part(body, 0.28, 1.1, 0.28, legs, side * 0.22, 0.85, 0);
    part(body, 0.36, 0.3, 0.5, shoe, side * 0.22, 0.15, 0.05);
  }

  // The flaming dress: three glowing layers with flame tips round the hem.
  model.dress = [glowMat(1.15, 0.85, 0.2, model), glowMat(1.25, 0.62, 0.14, model), glowMat(1.25, 0.42, 0.1, model)];
  part(body, 2.3, 0.45, 1.9, model.dress[0]!, 0, 1.6, 0);
  part(body, 2.0, 0.45, 1.65, model.dress[1]!, 0, 2.02, 0);
  part(body, 1.6, 0.4, 1.35, model.dress[2]!, 0, 2.42, 0);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    part(body, 0.3, 0.35, 0.3, model.dress[i % 2]!, Math.cos(a) * 1.05, 1.28, Math.sin(a) * 0.88);
  }

  // Bodice and arms, hands clasped in front.
  part(body, 0.95, 0.75, 0.7, bodice, 0, 2.95, 0);
  for (const side of [-1, 1]) {
    part(body, 0.26, 0.55, 0.26, bodice, side * 0.58, 3.12, 0.12);
    part(body, 0.5, 0.24, 0.24, bodice, side * 0.32, 2.92, 0.45);
  }
  part(body, 0.3, 0.3, 0.26, skin, 0, 2.98, 0.62);

  // Head with big dark eyes, sparkly highlights and red lips.
  part(body, 1.45, 1.35, 1.25, skin, 0, 4.05, 0);
  for (const side of [-1, 1]) {
    part(body, 0.54, 0.62, 0.04, rim, side * 0.33, 4.08, 0.63);
    part(body, 0.42, 0.5, 0.06, black, side * 0.33, 4.08, 0.65);
    part(body, 0.12, 0.12, 0.04, white, side * 0.26, 4.2, 0.69);
    part(body, 0.06, 0.06, 0.04, white, side * 0.4, 3.95, 0.69);
  }
  part(body, 0.26, 0.08, 0.04, lips, 0, 3.66, 0.64);

  // Lots of long red hair.
  part(body, 1.7, 0.5, 1.5, hair, 0, 4.86, -0.02);
  part(body, 1.45, 0.3, 0.2, hair, 0, 4.62, 0.64);
  part(body, 1.9, 2.9, 0.5, hair, 0, 3.35, -0.62);
  for (const side of [-1, 1]) {
    part(body, 0.45, 2.5, 1.2, hair, side * 0.93, 3.45, -0.05);
    part(body, 0.3, 1.5, 0.3, hair, side * 0.74, 3.8, 0.6);
    part(body, 0.24, 0.36, 0.24, rim, side * 0.45, 5.25, 0);
  }

  // Her own fire lights her face, hair and top, so they skip the moonlight tint.
  const selfLit = new Set([hair, skin, bodice, black, white, rim, lips]);
  model.lit = model.lit.filter((m) => !selfLit.has(m));

  // Roses circling her.
  model.roses = new Group();
  model.roses.position.y = 2.6;
  body.add(model.roses);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    addRose(model, model.roses, Math.cos(a) * 2.3, Math.sin(i * 2.1) * 1.1, Math.sin(a) * 2.3, 1.3);
  }
  return model;
}

/** A burning rose fired in Fire Rose's spiral. */
export function makeFirePetal(): Model {
  const model: Model = { group: new Group(), lit: [], glow: [] };
  part(model.group, 0.42, 0.42, 0.42, glowMat(2.6, 0.45, 0.3, model), 0, 0, 0);
  const core = part(model.group, 0.24, 0.24, 0.24, glowMat(3.2, 1.8, 0.4, model), 0, 0, 0);
  core.rotation.set(0.7, 0.7, 0);
  return model;
}

/** A rose bud that sprouts from the ground before bursting into flame. */
export function makeRoseBud(): Model {
  const model: Model = { group: new Group(), lit: [], glow: [] };
  part(model.group, 0.1, 0.5, 0.1, litMat(null, model, 0x3f8a3a), 0, 0.25, 0);
  addRose(model, model.group, 0, 0.6, 0, 0.9);
  return model;
}

/** A column of fire. */
export function makeFirePillar(): Model {
  const model: Model = { group: new Group(), lit: [], glow: [] };
  const outer = glowMat(2.6, 0.9, 0.15, model);
  outer.transparent = true;
  outer.opacity = 0.75;
  part(model.group, 1.6, 6, 1.6, outer, 0, 3, 0);
  part(model.group, 0.8, 6.4, 0.8, glowMat(3.2, 2.2, 0.5, model), 0, 3.2, 0);
  return model;
}

/** The Flaming Sword. `view` builds the first-person version drawn over everything. */
export function makeFlameSword(view: boolean): Model {
  const model: Model = { group: new Group(), lit: [], glow: [] };
  const mat = (color: number) => (view ? viewMat(model, null, color) : litMat(null, model, color));
  const glow = (r: number, g: number, b: number) => {
    const m = glowMat(r, g, b, model);
    if (view) {
      m.depthTest = false;
      m.depthWrite = false;
    }
    return m;
  };
  const grip = mat(0x3a2418);
  const gold = mat(0xc8902c);
  part(model.group, 0.05, 0.18, 0.05, grip, 0, 0, 0);
  part(model.group, 0.08, 0.07, 0.08, gold, 0, -0.11, 0);
  part(model.group, 0.32, 0.06, 0.08, gold, 0, 0.11, 0);
  const flame = view ? glow(1.3, 0.38, 0.08) : glow(2.4, 0.7, 0.15);
  const core = view ? glow(1.5, 1.0, 0.3) : glow(2.8, 2, 0.5);
  part(model.group, 0.08, 0.66, 0.03, flame, 0, 0.47, 0);
  part(model.group, 0.03, 0.66, 0.035, core, 0.025, 0.47, 0);
  part(model.group, 0.05, 0.1, 0.03, flame, 0, 0.84, 0);
  if (view) model.group.traverse((o) => (o.renderOrder = 51));
  return model;
}

// ---------- The giant door ----------

export type DoorModel = Model & { left: Group; right: Group };

/** Two huge wooden door leaves, hinged at the outer edges. Faces +z. */
export function makeGiantDoor(width: number, height: number): DoorModel {
  const t = tex();
  const model = { group: new Group(), lit: [], glow: [] } as unknown as DoorModel;
  const wood = litMat(t.doorWood, model);
  const iron = litMat(null, model, 0x4a4a52);
  const half = width / 2;
  const leaf = (side: number) => {
    const pivot = new Group();
    pivot.position.set(side * half, 0, 0);
    model.group.add(pivot);
    const cx = -side * half / 2;
    part(pivot, half, height, 0.5, wood, cx, height / 2, 0);
    for (const y of [1.2, height / 2, height - 1.2]) part(pivot, half, 0.32, 0.58, iron, cx, y, 0);
    part(pivot, 0.5, 0.5, 0.64, iron, -side * (half - 0.6), height / 2 - 0.8, 0);
    return pivot;
  };
  model.left = leaf(-1);
  model.right = leaf(1);
  return model;
}

// ---------- Heart pickup ----------

const HEART = [".XX.XX.", "XXXXXXX", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."];

export function makeHeart(): Model {
  const model: Model = { group: new Group(), lit: [], glow: [] };
  const mat = glowMat(2.4, 0.3, 0.42, model);
  const s = 0.09;
  HEART.forEach((row, y) => {
    [...row].forEach((c, x) => {
      if (c === "X") part(model.group, s, s, s * 1.4, mat, (x - 3) * s, (HEART.length - y) * s, 0);
    });
  });
  return model;
}

// ---------- First-person sword and shield ----------

function viewMat(model: Model, map: Texture | null, color: number): MeshBasicMaterial {
  const m = litMat(map, model, color);
  m.depthTest = false;
  m.depthWrite = false;
  return m;
}

export function makeSword(): Model {
  const model: Model = { group: new Group(), lit: [], glow: [] };
  const steel = viewMat(model, null, 0xd4dde8);
  const edge = viewMat(model, null, 0xf4f8ff);
  const gold = viewMat(model, null, 0xf2c14e);
  const grip = viewMat(model, null, 0x6b4426);
  part(model.group, 0.045, 0.18, 0.045, grip, 0, 0, 0);
  part(model.group, 0.07, 0.06, 0.07, gold, 0, -0.11, 0);
  part(model.group, 0.28, 0.05, 0.07, gold, 0, 0.11, 0);
  part(model.group, 0.07, 0.62, 0.025, steel, 0, 0.45, 0);
  part(model.group, 0.02, 0.62, 0.03, edge, 0.03, 0.45, 0);
  part(model.group, 0.045, 0.08, 0.025, steel, 0, 0.8, 0);
  model.group.traverse((o) => (o.renderOrder = 51));
  return model;
}

export function makeShield(): Model {
  const model: Model = { group: new Group(), lit: [], glow: [] };
  part(model.group, 0.48, 0.58, 0.05, viewMat(model, tex().shield, 0xffffff), 0, 0, 0);
  part(model.group, 0.12, 0.14, 0.04, viewMat(model, null, 0x9aa0ad), 0, 0, 0.04);
  model.group.traverse((o) => (o.renderOrder = 50));
  return model;
}

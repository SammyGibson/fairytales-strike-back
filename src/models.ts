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

import { BufferGeometry, Float32BufferAttribute } from "three";
import { B, BLOCKS, isOccluder, isOpaque, type BlockDef } from "./blocks";
import { ATLAS_COLS, ATLAS_ROWS } from "./textures";
import { CHUNK, type World } from "./world";

type Vec3 = [number, number, number];

type Face = {
  normal: Vec3;
  /** Corners in order bottom-left, bottom-right, top-right, top-left seen from outside. */
  corners: Vec3[];
  shade: number;
  tile: "top" | "side" | "bottom";
  /** Axes used for texture u and v on shaped boxes. */
  uAxis: 0 | 1 | 2;
  vAxis: 0 | 1 | 2;
};

const FACES: Face[] = [
  { normal: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.78, tile: "side", uAxis: 2, vAxis: 1 },
  { normal: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.78, tile: "side", uAxis: 2, vAxis: 1 },
  { normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1, tile: "top", uAxis: 0, vAxis: 2 },
  { normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5, tile: "bottom", uAxis: 0, vAxis: 2 },
  { normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.66, tile: "side", uAxis: 0, vAxis: 1 },
  { normal: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.66, tile: "side", uAxis: 0, vAxis: 1 },
];

/** Moonlight: the base light everything gets, in sRGB terms. */
const AMBIENT: Vec3 = [0.36, 0.4, 0.62];
/** Linear brightness of glowing blocks; above 1 so the bloom pass picks them up. */
const EMISSIVE = 1.5;
const AO_LEVELS = [1, 0.8, 0.64, 0.5];
const UV_INSET = 0.01;
const WATER_TOP = 0.88;
const MAX_LIGHT = 1.15;

function toLinear(c: number): number {
  return Math.pow(Math.min(c, MAX_LIGHT), 2.2);
}

class MeshBuilder {
  positions: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

  /** Adds a quad. `uv` is [u0, v0, u1, v1] in tile units (0-1). */
  quad(corners: Vec3[], tile: number, colors: Vec3[], uv: [number, number, number, number] = [0, 0, 1, 1], flipCheck = 0): void {
    const base = this.positions.length / 3;
    const col = tile % ATLAS_COLS;
    const row = Math.floor(tile / ATLAS_COLS);
    const U = (t: number) => (col + UV_INSET + t * (1 - 2 * UV_INSET)) / ATLAS_COLS;
    const V = (t: number) => 1 - (row + UV_INSET + (1 - t) * (1 - 2 * UV_INSET)) / ATLAS_ROWS;
    const u0 = U(uv[0]), u1 = U(uv[2]), v0 = V(uv[1]), v1 = V(uv[3]);
    const uvs = [u0, v0, u1, v0, u1, v1, u0, v1];
    for (let i = 0; i < 4; i++) {
      const c = corners[i]!;
      const k = colors[i]!;
      this.positions.push(c[0], c[1], c[2]);
      this.uvs.push(uvs[i * 2]!, uvs[i * 2 + 1]!);
      this.colors.push(k[0], k[1], k[2]);
    }
    // Flip the diagonal so corner shading blends evenly.
    if (flipCheck > 0) {
      this.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    } else {
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  build(): BufferGeometry | null {
    if (this.indices.length === 0) return null;
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.positions, 3));
    g.setAttribute("uv", new Float32BufferAttribute(this.uvs, 2));
    g.setAttribute("color", new Float32BufferAttribute(this.colors, 3));
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    return g;
  }
}

function faceVisible(id: number, neighbor: number): boolean {
  if (neighbor === B.AIR) return true;
  if (BLOCKS[id]!.liquid) return false;
  return BLOCKS[neighbor]!.transparent && neighbor !== id;
}

const tmpLight: Vec3 = [0, 0, 0];

/** Corner shading and smoothed block light for one vertex of a cube face. */
function vertexLight(world: World, x: number, y: number, z: number, face: Face, corner: Vec3, out: Vec3): number {
  const n = face.normal;
  const axis = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
  const a1 = ((axis + 1) % 3) as 0 | 1 | 2;
  const a2 = ((axis + 2) % 3) as 0 | 1 | 2;
  const block: Vec3 = [x, y, z];
  const q: Vec3 = [0, 0, 0];
  q[axis] = block[axis] + n[axis];
  let occluders = 0;
  let samples = 0;
  out[0] = out[1] = out[2] = 0;
  for (const d1 of [-1, 0]) {
    for (const d2 of [-1, 0]) {
      q[a1] = block[a1] + corner[a1] + d1;
      q[a2] = block[a2] + corner[a2] + d2;
      const id = world.get(q[0], q[1], q[2]);
      if (isOccluder(id)) occluders++;
      if (isOpaque(id)) continue;
      world.lightAt(q[0], q[1], q[2], tmpLight);
      out[0] += tmpLight[0];
      out[1] += tmpLight[1];
      out[2] += tmpLight[2];
      samples++;
    }
  }
  if (samples > 0) {
    out[0] /= samples;
    out[1] /= samples;
    out[2] /= samples;
  }
  return Math.min(occluders, 3);
}

function litColor(shade: number, ao: number, light: Vec3): Vec3 {
  return [
    toLinear((AMBIENT[0] * shade + light[0]) * ao),
    toLinear((AMBIENT[1] * shade + light[1]) * ao),
    toLinear((AMBIENT[2] * shade + light[2]) * ao),
  ];
}

const EMISSIVE_COLOR: Vec3 = [EMISSIVE, EMISSIVE, EMISSIVE];

/** Draws an axis-aligned box inside a block cell, all six faces. */
function emitBox(
  out: MeshBuilder,
  x: number,
  y: number,
  z: number,
  min: Vec3,
  max: Vec3,
  tile: number,
  emissive: boolean,
  cellLight: Vec3,
  vRange?: [number, number],
): void {
  for (const face of FACES) {
    const corners = face.corners.map(
      (c) => [x + min[0] + c[0] * (max[0] - min[0]), y + min[1] + c[1] * (max[1] - min[1]), z + min[2] + c[2] * (max[2] - min[2])] as Vec3,
    );
    const color = emissive ? EMISSIVE_COLOR : litColor(face.shade, 1, cellLight);
    const uv: [number, number, number, number] = [min[face.uAxis], min[face.vAxis], max[face.uAxis], max[face.vAxis]];
    if (vRange) {
      uv[1] = vRange[0];
      uv[3] = vRange[1];
    }
    out.quad(corners, tile, [color, color, color, color], uv);
  }
}

function emitShape(out: MeshBuilder, world: World, id: number, def: BlockDef, x: number, y: number, z: number): void {
  const light = world.lightAt(x, y, z, [0, 0, 0]);
  switch (def.shape) {
    case "fence": {
      emitBox(out, x, y, z, [0.375, 0, 0.375], [0.625, 1, 0.625], def.side, false, light);
      const joins = (nx: number, nz: number) => {
        const n = world.get(nx, y, nz);
        return n === B.FENCE || isOpaque(n);
      };
      for (const [ry0, ry1] of [[0.4, 0.55], [0.75, 0.9]] as const) {
        if (joins(x + 1, z)) emitBox(out, x, y, z, [0.625, ry0, 0.4375], [1, ry1, 0.5625], def.side, false, light);
        if (joins(x - 1, z)) emitBox(out, x, y, z, [0, ry0, 0.4375], [0.375, ry1, 0.5625], def.side, false, light);
        if (joins(x, z + 1)) emitBox(out, x, y, z, [0.4375, ry0, 0.625], [0.5625, ry1, 1], def.side, false, light);
        if (joins(x, z - 1)) emitBox(out, x, y, z, [0.4375, ry0, 0], [0.5625, ry1, 0.375], def.side, false, light);
      }
      break;
    }
    case "lantern":
      emitBox(out, x, y, z, [0.28, 0, 0.28], [0.72, 0.55, 0.72], def.side, true, light);
      emitBox(out, x, y, z, [0.22, 0.55, 0.22], [0.78, 0.66, 0.78], BLOCKS[B.FENCE]!.side, false, light);
      emitBox(out, x, y, z, [0.44, 0.66, 0.44], [0.56, 0.78, 0.56], BLOCKS[B.FENCE]!.side, false, light);
      break;
    case "banner": {
      // A two-block banner: the upper cell shows the top half of the art.
      const lower = world.get(x, y + 1, z) === id;
      const vRange: [number, number] = lower ? [0, 0.5] : [0.5, 1];
      emitBox(out, x, y, z, [0.06, 0, 0.45], [0.94, 1, 0.55], def.side, false, light, vRange);
      break;
    }
    case "shroom":
      emitBox(out, x, y, z, [0.44, 0, 0.44], [0.56, 0.35, 0.56], BLOCKS[B.STEM]!.side, false, light);
      emitBox(out, x, y, z, [0.24, 0.35, 0.24], [0.76, 0.6, 0.76], def.top, true, light);
      break;
    case "cube":
      break;
  }
}

/** Builds the meshes for one 16x16 column of the world. Water gets its own mesh. */
export function buildChunk(world: World, cx: number, cz: number) {
  const solid = new MeshBuilder();
  const water = new MeshBuilder();
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  const light: Vec3 = [0, 0, 0];

  for (let y = 0; y < world.height; y++) {
    for (let z = z0; z < z0 + CHUNK; z++) {
      for (let x = x0; x < x0 + CHUNK; x++) {
        const id = world.get(x, y, z);
        if (id === B.AIR) continue;
        const def = BLOCKS[id]!;
        if (def.shape !== "cube") {
          emitShape(solid, world, id, def, x, y, z);
          continue;
        }
        const top = def.liquid && world.get(x, y + 1, z) !== B.WATER ? WATER_TOP : 1;

        for (const face of FACES) {
          const n = face.normal;
          const neighbor = world.get(x + n[0], y + n[1], z + n[2]);
          if (!faceVisible(id, neighbor)) continue;

          const corners = face.corners.map((c) => [x + c[0], y + (c[1] === 1 ? top : 0), z + c[2]] as Vec3);
          const aos: number[] = [];
          const colors = face.corners.map((c) => {
            const occ = vertexLight(world, x, y, z, face, c, light);
            const ao = def.liquid ? 1 : AO_LEVELS[occ]!;
            aos.push(ao);
            if (def.emissive && face.tile === "top") return EMISSIVE_COLOR;
            if (def.emissive && id !== B.GOO) return EMISSIVE_COLOR;
            return litColor(face.shade, ao, light);
          });
          const flip = aos[0]! + aos[2]! < aos[1]! + aos[3]! ? 1 : 0;
          (def.liquid ? water : solid).quad(corners, def[face.tile], colors, undefined, flip);
        }
      }
    }
  }

  return { solid: solid.build(), water: water.build() };
}

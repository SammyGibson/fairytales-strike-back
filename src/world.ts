import { B, BLOCKS, isOpaque } from "./blocks";

export const CHUNK = 16;
export const WORLD_CHUNKS = 8;
export const WORLD_SIZE = CHUNK * WORLD_CHUNKS;
export const WORLD_HEIGHT = 48;

/** A fixed-size block world. Blocks live in one flat array indexed by (y, z, x). */
export class World {
  readonly size = WORLD_SIZE;
  readonly height = WORLD_HEIGHT;
  readonly data = new Uint8Array(WORLD_SIZE * WORLD_SIZE * WORLD_HEIGHT);
  /** Coloured light from glowing blocks, per cell, 0 to ~1.5 per channel. */
  readonly lightR = new Float32Array(this.data.length);
  readonly lightG = new Float32Array(this.data.length);
  readonly lightB = new Float32Array(this.data.length);

  index(x: number, y: number, z: number): number {
    return (y * this.size + z) * this.size + x;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && z >= 0 && y >= 0 && x < this.size && z < this.size && y < this.height;
  }

  /** Below the world counts as bedrock; beside or above it is air. */
  get(x: number, y: number, z: number): number {
    if (y < 0) return B.BEDROCK;
    if (!this.inBounds(x, y, z)) return B.AIR;
    return this.data[this.index(x, y, z)]!;
  }

  set(x: number, y: number, z: number, id: number): void {
    if (this.inBounds(x, y, z)) this.data[this.index(x, y, z)] = id;
  }

  /** Sets a block only if the cell is currently air. */
  setIfAir(x: number, y: number, z: number, id: number): void {
    if (this.get(x, y, z) === B.AIR) this.set(x, y, z, id);
  }

  /** Collision test. The world edges act as invisible walls. */
  isSolid(x: number, y: number, z: number): boolean {
    if (y < 0 || x < 0 || z < 0 || x >= this.size || z >= this.size) return true;
    if (y >= this.height) return false;
    return BLOCKS[this.data[this.index(x, y, z)]!]!.solid;
  }

  /** Height of the highest solid block in a column, or -1. */
  surfaceY(x: number, z: number): number {
    for (let y = this.height - 1; y >= 0; y--) {
      if (BLOCKS[this.get(x, y, z)]!.solid) return y;
    }
    return -1;
  }

  /** Light reaching a cell, as [r, g, b]. */
  lightAt(x: number, y: number, z: number, out: [number, number, number]): [number, number, number] {
    if (!this.inBounds(x, y, z)) {
      out[0] = out[1] = out[2] = 0;
      return out;
    }
    const i = this.index(x, y, z);
    out[0] = this.lightR[i]!;
    out[1] = this.lightG[i]!;
    out[2] = this.lightB[i]!;
    return out;
  }

  /** Floods light outward from every glowing block, stopping at solid walls. */
  computeLighting(): void {
    this.lightR.fill(0);
    this.lightG.fill(0);
    this.lightB.fill(0);
    const stamp = new Int32Array(this.data.length);
    const queue = new Int32Array(this.data.length);
    const dist = new Uint8Array(this.data.length);
    const s = this.size;
    const layer = s * s;
    let source = 0;

    for (let i = 0; i < this.data.length; i++) {
      const light = BLOCKS[this.data[i]!]!.light;
      if (!light) continue;
      source++;
      let head = 0;
      let tail = 0;
      queue[tail++] = i;
      stamp[i] = source;
      dist[i] = 0;
      while (head < tail) {
        const c = queue[head++]!;
        const d = dist[c]!;
        const f = Math.pow(1 - d / light.radius, 1.5);
        this.lightR[c] = this.lightR[c]! + light.r * f;
        this.lightG[c] = this.lightG[c]! + light.g * f;
        this.lightB[c] = this.lightB[c]! + light.b * f;
        if (d + 1 >= light.radius) continue;
        const x = c % s;
        const z = Math.floor(c / s) % s;
        const y = Math.floor(c / layer);
        const next = (n: number) => {
          if (stamp[n] === source) return;
          stamp[n] = source;
          if (isOpaque(this.data[n]!)) return;
          dist[n] = d + 1;
          queue[tail++] = n;
        };
        if (x > 0) next(c - 1);
        if (x < s - 1) next(c + 1);
        if (z > 0) next(c - s);
        if (z < s - 1) next(c + s);
        if (y > 0) next(c - layer);
        if (y < this.height - 1) next(c + layer);
      }
    }
  }
}

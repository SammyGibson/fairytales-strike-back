import { CanvasTexture, NearestFilter, SRGBColorSpace } from "three";
import { T } from "./blocks";
import { mulberry32 } from "./noise";

// All block art is drawn in code as 16x16 pixel tiles packed into one atlas.
export const TILE = 16;
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 3;

export type RGB = [number, number, number];

export type Atlas = {
  canvas: HTMLCanvasElement;
  /** Average colour of each tile, used for particles. */
  avgColors: RGB[];
};

type Painter = (x: number, y: number, rand: () => number) => RGB | [number, number, number, number] | null;

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function mul(c: RGB, f: number): RGB {
  return [c[0] * f, c[1] * f, c[2] * f];
}

export function buildAtlas(): Atlas {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_COLS * TILE;
  canvas.height = ATLAS_ROWS * TILE;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(canvas.width, canvas.height);
  const rand = mulberry32(1337);
  const j = (amount: number) => 1 + (rand() - 0.5) * amount;

  const paint = (tile: number, fn: Painter) => {
    const ox = (tile % ATLAS_COLS) * TILE;
    const oy = Math.floor(tile / ATLAS_COLS) * TILE;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const c = fn(x, y, rand);
        const i = ((oy + y) * canvas.width + ox + x) * 4;
        if (!c) {
          img.data[i + 3] = 0;
          continue;
        }
        img.data[i] = clamp(c[0]);
        img.data[i + 1] = clamp(c[1]);
        img.data[i + 2] = clamp(c[2]);
        img.data[i + 3] = c.length === 4 ? c[3] : 255;
      }
    }
  };

  const GRASS: RGB = [74, 132, 66];
  const DIRT: RGB = [116, 82, 60];
  const STONE: RGB = [112, 112, 122];

  paint(T.GRASS_TOP, () => mul(GRASS, j(0.35)));
  paint(T.DIRT, () => mul(DIRT, rand() < 0.08 ? 0.72 : j(0.25)));
  const depth = Array.from({ length: TILE }, () => 3 + Math.floor(rand() * 3));
  paint(T.GRASS_SIDE, (x, y) => (y < depth[x]! ? mul(GRASS, j(0.3)) : mul(DIRT, j(0.25))));
  paint(T.STONE, () => mul(STONE, rand() < 0.1 ? 0.75 : j(0.2)));
  paint(T.MOSSY, () => (rand() < 0.35 ? mul([70, 110, 64], j(0.3)) : mul(STONE, j(0.2))));
  paint(T.PATH, () => (rand() < 0.15 ? mul([150, 140, 128], j(0.2)) : mul([122, 96, 72], j(0.22))));
  paint(T.LOG_SIDE, (x) => mul([78, 56, 40], (x % 4 === 0 ? 0.72 : 1) * j(0.15)));
  paint(T.LOG_TOP, (x, y) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d > 6.8) return mul([78, 56, 40], j(0.15));
    return mul(Math.floor(d) % 2 ? [150, 118, 78] : [124, 94, 58], j(0.08));
  });
  paint(T.PINE, () => (rand() < 0.14 ? null : mul([42, 92, 58], j(0.45))));
  paint(T.PLANKS, (x, y) => {
    const board = Math.floor(y / 4);
    const seam = y % 4 === 3 || x === (board * 5) % TILE;
    return mul([132, 94, 62], seam ? 0.65 : j(0.12));
  });
  paint(T.FENCE, (x) => mul([108, 76, 50], (x % 5 === 0 ? 0.75 : 1) * j(0.12)));
  paint(T.CASTLE, (x, y) => {
    const row = Math.floor(y / 4);
    const mortar = y % 4 === 3 || (x + (row % 2) * 4) % 8 === 7;
    return mortar ? mul([50, 46, 58], j(0.1)) : mul([96, 90, 108], j(0.2));
  });
  paint(T.SLATE, (x, y) => {
    const row = Math.floor(y / 3);
    const edge = y % 3 === 2 || (x + (row % 2) * 2) % 4 === 3;
    return mul([62, 60, 92], edge ? 0.62 : j(0.15));
  });
  paint(T.WINDOW, (x, y) => {
    const frame = x < 2 || y < 2 || x > 13 || y > 13 || x === 7 || x === 8 || y === 7 || y === 8;
    return frame ? mul([46, 36, 30], j(0.1)) : mul([255, 196, 104], j(0.08) * (1 - y * 0.012));
  });
  paint(T.WATER, () => mul([42, 86, 170], j(0.14)));
  paint(T.BEDROCK, () => mul([52, 50, 58], j(0.7)));
  paint(T.GOO, (x, y) => {
    const blob = Math.sin(x * 0.9) + Math.cos(y * 1.1) > 0.9;
    return blob ? mul([236, 150, 255], j(0.08)) : mul([168, 58, 236], j(0.18));
  });
  paint(T.STEM, () => mul([222, 214, 198], j(0.1)));
  const spots = (x: number, y: number) =>
    [[3, 3], [11, 4], [6, 10], [12, 12], [2, 13]].some(([sx, sy]) => Math.hypot(x - sx!, y - sy!) < 1.6);
  paint(T.CAP_PURPLE, (x, y) => (spots(x, y) ? mul([250, 230, 255], j(0.05)) : mul([176, 64, 236], j(0.14))));
  paint(T.CAP_CYAN, (x, y) => (spots(x, y) ? mul([230, 250, 255], j(0.05)) : mul([56, 196, 244], j(0.14))));
  paint(T.CRYSTAL, (x, y) => {
    const facet = (x + y) % 6 < 2 || (x - y + 16) % 7 === 0;
    return mul(facet ? [240, 196, 255] : [172, 92, 240], j(0.1));
  });
  paint(T.LANTERN, (x, y) => {
    const frame = x < 2 || x > 13 || y < 2 || y > 13 || x === 7 || x === 8;
    if (frame) return mul([34, 28, 26], j(0.1));
    const d = Math.hypot(x - 7.5, y - 8);
    return mul([255, 214, 132], 1.05 - d * 0.04);
  });
  paint(T.BANNER, (x, y) => {
    if (y > 13 && (x + y) % 3 === 0) return null;
    const emblem =
      (y === 4 && x >= 5 && x <= 10) ||
      (y >= 5 && y <= 8 && x >= 4 && x <= 11 && !(y === 8 && (x === 4 || x === 11))) ||
      (y === 9 && x >= 6 && x <= 9) ||
      (y === 10 && x >= 7 && x <= 8);
    if (emblem) return mul([238, 226, 210], j(0.06));
    const border = x === 0 || x === TILE - 1;
    return mul(border ? [120, 26, 30] : [184, 40, 44], j(0.12));
  });

  ctx.putImageData(img, 0, 0);

  const avgColors: RGB[] = [];
  for (let tile = 0; tile < ATLAS_COLS * ATLAS_ROWS; tile++) {
    let r = 0, g = 0, b = 0, n = 0;
    const ox = (tile % ATLAS_COLS) * TILE;
    const oy = Math.floor(tile / ATLAS_COLS) * TILE;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const i = ((oy + y) * canvas.width + ox + x) * 4;
        if (img.data[i + 3]! < 128) continue;
        r += img.data[i]!;
        g += img.data[i + 1]!;
        b += img.data[i + 2]!;
        n++;
      }
    }
    avgColors.push(n ? [r / n, g / n, b / n] : [255, 255, 255]);
  }

  return { canvas, avgColors };
}

/** A small pixel texture for character models. */
export function pixelTexture(width: number, height: number, seed: number, fn: Painter): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(width, height);
  const rand = mulberry32(seed);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = fn(x, y, rand);
      const i = (y * width + x) * 4;
      if (!c) continue;
      img.data[i] = clamp(c[0]);
      img.data[i + 1] = clamp(c[1]);
      img.data[i + 2] = clamp(c[2]);
      img.data[i + 3] = c.length === 4 ? c[3] : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

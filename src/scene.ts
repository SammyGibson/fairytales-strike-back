import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Fog,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { buildChunk } from "./mesher";
import { mulberry32 } from "./noise";
import type { Atlas } from "./textures";
import { WORLD_CHUNKS, type World } from "./world";

const FOG = 0x1d1c42;
const HORIZON = new Color(0x3b3474);
const ZENITH = new Color(0x070a1e);
const MAX_PARTICLES = 600;
const MOON_DIR = new Vector3(0.28, 0.42, -1).normalize();

type Particle = { pos: Vector3; vel: Vector3; life: number; maxLife: number; size: number; color: Color; gravity: number };

export type BurstOptions = {
  count?: number;
  speed?: number;
  up?: number;
  gravity?: number;
  life?: number;
  size?: number;
  spread?: number;
};

export class GameScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(72, 1, 0.05, 600);

  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly solidMaterial: MeshBasicMaterial;
  private readonly waterMaterial: MeshBasicMaterial;
  private readonly chunkMeshes: Mesh[] = [];
  private readonly clouds = new Group();
  private readonly sky: Mesh;
  private readonly stars: Points;
  private readonly moon: Mesh;
  private readonly moonHalo: Mesh;
  private readonly particleMesh: InstancedMesh;
  private readonly particles: Particle[] = [];
  private readonly dummy = new Object3D();

  constructor(canvas: HTMLCanvasElement, atlas: Atlas) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.scene.background = new Color(FOG);
    this.scene.fog = new Fog(FOG, 22, 92);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);

    const texture = new CanvasTexture(atlas.canvas);
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = SRGBColorSpace;
    this.solidMaterial = new MeshBasicMaterial({ map: texture, vertexColors: true, alphaTest: 0.5 });
    this.waterMaterial = new MeshBasicMaterial({
      map: texture,
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      side: DoubleSide,
    });

    this.sky = this.makeSky();
    this.stars = this.makeStars();
    [this.moon, this.moonHalo] = this.makeMoon();
    this.makeClouds();

    this.particleMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), MAX_PARTICLES);
    this.particleMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.particleMesh.setColorAt(0, new Color());
    this.particleMesh.count = 0;
    this.particleMesh.frustumCulled = false;
    this.scene.add(this.particleMesh);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Gentle glow: only the brightest things bloom, and not too far.
    this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.5, 0.4, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  /** Replaces all terrain meshes with ones built from this world. */
  setWorld(world: World): void {
    for (const mesh of this.chunkMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.chunkMeshes.length = 0;
    for (let cz = 0; cz < WORLD_CHUNKS; cz++) {
      for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
        const geo = buildChunk(world, cx, cz);
        if (geo.solid) this.chunkMeshes.push(new Mesh(geo.solid, this.solidMaterial));
        if (geo.water) {
          const water = new Mesh(geo.water, this.waterMaterial);
          water.renderOrder = 1;
          this.chunkMeshes.push(water);
        }
      }
    }
    for (const mesh of this.chunkMeshes) this.scene.add(mesh);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloom.setSize(width / 2, height / 2);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private makeSky(): Mesh {
    const geo = new SphereGeometry(400, 24, 16);
    const pos = geo.getAttribute("position");
    const colors: number[] = [];
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i) / 400);
      c.copy(HORIZON).lerp(ZENITH, Math.pow(t, 0.6));
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new Float32BufferAttribute(colors, 3));
    const sky = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -10;
    this.scene.add(sky);
    return sky;
  }

  private makeStars(): Points {
    const rand = mulberry32(7);
    const positions: number[] = [];
    for (let i = 0; i < 900; i++) {
      const theta = rand() * Math.PI * 2;
      const y = 0.08 + rand() * 0.92;
      const r = Math.sqrt(1 - y * y);
      positions.push(Math.cos(theta) * r * 380, y * 380, Math.sin(theta) * r * 380);
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    const stars = new Points(geo, new PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, depthWrite: false }));
    stars.renderOrder = -9;
    this.scene.add(stars);
    return stars;
  }

  private makeMoon(): [Mesh, Mesh] {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    const rand = mulberry32(3);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const d = Math.hypot(x - 31.5, y - 31.5);
        if (d > 30) continue;
        const crater = [[22, 24, 6], [40, 20, 4], [36, 40, 7], [18, 42, 3], [44, 32, 3]].some(
          ([cx, cy, r]) => Math.hypot(x - cx!, y - cy!) < r!,
        );
        const v = (crater ? 196 : 236) + (rand() - 0.5) * 18 - d * 0.6;
        ctx.fillStyle = `rgb(${v},${v},${v + 14})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    const moonMat = new MeshBasicMaterial({ map: tex, transparent: true, fog: false, depthWrite: false });
    moonMat.color.setRGB(1.5, 1.5, 1.6);
    const moon = new Mesh(new PlaneGeometry(60, 60), moonMat);
    moon.renderOrder = -8;

    const halo = document.createElement("canvas");
    halo.width = halo.height = 128;
    const hctx = halo.getContext("2d")!;
    const grad = hctx.createRadialGradient(64, 64, 10, 64, 64, 64);
    grad.addColorStop(0, "rgba(170,180,255,0.55)");
    grad.addColorStop(1, "rgba(120,110,255,0)");
    hctx.fillStyle = grad;
    hctx.fillRect(0, 0, 128, 128);
    const haloTex = new CanvasTexture(halo);
    haloTex.colorSpace = SRGBColorSpace;
    const haloMesh = new Mesh(
      new PlaneGeometry(220, 220),
      new MeshBasicMaterial({ map: haloTex, transparent: true, blending: AdditiveBlending, fog: false, depthWrite: false }),
    );
    haloMesh.renderOrder = -9;
    this.scene.add(haloMesh, moon);
    return [moon, haloMesh];
  }

  private makeClouds(): void {
    const rand = mulberry32(42);
    const material = new MeshBasicMaterial({ color: 0x343a6e, transparent: true, opacity: 0.85, fog: false });
    for (let i = 0; i < 26; i++) {
      const cloud = new Mesh(new BoxGeometry(14 + rand() * 24, 3, 8 + rand() * 14), material);
      cloud.position.set(-160 + rand() * 450, 70 + rand() * 14, -180 + rand() * 300);
      this.clouds.add(cloud);
    }
    this.scene.add(this.clouds);
  }

  /** Spawns a burst of little cubes. Colours are 0-255 sRGB. */
  burst(at: Vector3, rgb: [number, number, number], opts: BurstOptions = {}): void {
    const count = opts.count ?? 14;
    const speed = opts.speed ?? 4;
    const spread = opts.spread ?? 0.6;
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      const shade = 0.8 + Math.random() * 0.4;
      const life = (opts.life ?? 0.7) * (0.7 + Math.random() * 0.6);
      this.particles.push({
        pos: new Vector3(at.x + (Math.random() - 0.5) * spread, at.y + (Math.random() - 0.5) * spread, at.z + (Math.random() - 0.5) * spread),
        vel: new Vector3((Math.random() - 0.5) * speed, (opts.up ?? 3) * (0.5 + Math.random()), (Math.random() - 0.5) * speed),
        life,
        maxLife: life,
        size: (opts.size ?? 0.14) * (0.7 + Math.random() * 0.6),
        color: new Color().setRGB((rgb[0] / 255) * shade, (rgb[1] / 255) * shade, (rgb[2] / 255) * shade, SRGBColorSpace),
        gravity: opts.gravity ?? 18,
      });
    }
  }

  update(dt: number): void {
    const cam = this.camera.position;
    this.sky.position.copy(cam);
    this.stars.position.copy(cam);
    this.moon.position.copy(cam).addScaledVector(MOON_DIR, 340);
    this.moon.lookAt(cam);
    this.moonHalo.position.copy(cam).addScaledVector(MOON_DIR, 345);
    this.moonHalo.lookAt(cam);
    for (const cloud of this.clouds.children) {
      cloud.position.x += dt * 1.5;
      if (cloud.position.x > 300) cloud.position.x -= 460;
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
    }
    let n = 0;
    for (const p of this.particles) {
      this.dummy.position.copy(p.pos);
      this.dummy.scale.setScalar(p.size * Math.min(1, (p.life / p.maxLife) * 2.5));
      this.dummy.rotation.set(p.life * 3, p.life * 2, 0);
      this.dummy.updateMatrix();
      this.particleMesh.setMatrixAt(n, this.dummy.matrix);
      this.particleMesh.setColorAt(n, p.color);
      n++;
    }
    this.particleMesh.count = n;
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
  }

  render(): void {
    this.composer.render();
  }
}

import { Vector3 } from "three";
import { makeFirePetal, makeFirePillar, makeFireRose, makeMarker, makeRoseBud, makeShockwave, type FireRoseModel, type Model } from "../models";
import { sfx } from "../sound";
import type { Boss, BossContext, BossState } from "./boss";

const tmp = new Vector3();
const eyes = new Vector3();

const FIRE: [number, number, number] = [255, 140, 40];
const ROSE: [number, number, number] = [220, 40, 50];
/** How high she floats; just off the ground so she's easy to reach. */
const HOVER = 0.35;
const PETALS_PER_RING = 14;
const BLOOM_WARN = 1.4;
const HITS_PER_BLINK = 4;
const RIBBON_SPEED = 6;
const RIBBON_MAX = 13;
/** Dress layer colours (above 1 so they glow), bottom to top. */
const DRESS: [number, number, number][] = [
  [1.15, 0.85, 0.2],
  [1.25, 0.62, 0.14],
  [1.25, 0.42, 0.1],
];

type Bloom = { bud: Model; marker: Model; pos: Vector3; timer: number; pillar: Model | null; burn: number };
type Ribbon = { model: ReturnType<typeof makeShockwave>; center: Vector3; radius: number; hit: boolean };

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Level 2 final boss: Fire Rose, who floats in a dress of flames with roses circling her.
 * - Rose Spiral: rings of burning petals fly out from her (block with the shield).
 * - Blooming Roses: buds sprout round the player, then burst into fire pillars (move away).
 * - Petal Blink: every few hits she vanishes in petals and reappears elsewhere (chase her).
 * - Flame Ribbon (when angry): a ring of fire sweeps out along the ground (jump over it).
 */
export class FireRoseBoss implements Boss {
  readonly name = "Fire Rose";
  readonly maxHp = 16;
  readonly radius = 1.4;
  hp = this.maxHp;
  state: BossState = "sleep";
  readonly pos: Vector3;

  private readonly model: FireRoseModel;
  private attack: "idle" | "spiral" | "bloom" | "ribbon" | "blink" = "idle";
  private next: "spiral" | "bloom" = "spiral";
  private attacksMade = 0;
  private yaw = 0;
  private timer = 0;
  private hurt = 0;
  private spin = 0;
  private ringsLeft = 0;
  private ringTimer = 0;
  private ringOffset = 0;
  private hitsSinceBlink = 0;
  private fade = 1;
  private blinkTo = new Vector3();
  private blooms: Bloom[] = [];
  private ribbons: Ribbon[] = [];

  constructor(private readonly ctx: BossContext, private readonly home: Vector3) {
    this.pos = home.clone();
    this.model = makeFireRose();
    ctx.gs.scene.add(this.model.group);
  }

  reset(): void {
    this.clearEffects();
    this.pos.copy(this.home);
    this.hp = this.maxHp;
    this.state = "sleep";
    this.attack = "idle";
    this.timer = 0;
    this.hurt = 0;
    this.hitsSinceBlink = 0;
    this.fade = 1;
    this.model.group.visible = true;
    this.model.group.scale.setScalar(1);
    this.model.group.rotation.set(0, 0, 0);
  }

  dispose(): void {
    this.clearEffects();
    this.ctx.gs.scene.remove(this.model.group);
  }

  emerge(from: Vector3): void {
    this.reset();
    this.pos.copy(from);
    this.state = "entering";
    this.timer = 1.6;
  }

  swordHit(reaches: (pos: Vector3, radius: number) => boolean, power: number): boolean {
    if (this.state !== "active" || this.attack === "blink" || !reaches(this.pos, this.radius)) return false;
    this.hp = Math.max(0, this.hp - power);
    this.hurt = 0.25;
    this.hitsSinceBlink++;
    sfx.bossHurt();
    const p = this.ctx.player.pos;
    this.ctx.gs.burst(tmp.copy(p).lerp(this.pos, 0.6).setY(this.pos.y + HOVER + 2.5), FIRE, { count: 14, speed: 5 });
    this.ctx.healthChanged();
    if (this.hp <= 0) {
      this.state = "dying";
      this.timer = 2;
      sfx.roar();
      this.clearEffects();
      this.ctx.clearProjectiles();
    } else if (this.hitsSinceBlink >= HITS_PER_BLINK && this.attack !== "spiral") {
      this.startBlink();
    }
    return true;
  }

  update(dt: number): void {
    const { ctx, model: m } = this;
    if (this.state === "dead") return;
    const p = ctx.player.pos;
    const t = performance.now() / 1000;
    this.hurt = Math.max(0, this.hurt - dt);
    this.timer -= dt;

    // Embers drifting up from her dress.
    if (this.fade > 0.5 && Math.random() < dt * 14) {
      tmp.set(this.pos.x + (Math.random() - 0.5) * 2, this.pos.y + HOVER + 1.2 + Math.random(), this.pos.z + (Math.random() - 0.5) * 2);
      ctx.gs.burst(tmp, Math.random() < 0.5 ? FIRE : [255, 210, 80], { count: 1, speed: 0.5, up: 1.5, gravity: -1, life: 0.9, size: 0.1, spread: 0.2 });
    }

    if (this.state === "dying") {
      this.spin += dt * 10;
      const k = Math.max(0, this.timer / 2);
      m.group.scale.setScalar(0.4 + k * 0.6);
      if (Math.random() < 0.7) ctx.gs.burst(tmp.copy(this.pos).setY(this.pos.y + HOVER + 2), Math.random() < 0.5 ? FIRE : ROSE, { count: 4, speed: 9, up: 6, size: 0.24 });
      if (this.timer <= 0) {
        this.state = "dead";
        m.group.visible = false;
        ctx.gs.burst(tmp.copy(this.pos).setY(this.pos.y + HOVER + 1.5), FIRE, { count: 70, speed: 11, up: 8, size: 0.3 });
        ctx.gs.burst(tmp, ROSE, { count: 40, speed: 9, up: 7, size: 0.26 });
        ctx.defeated();
      }
      this.pose(t, dt);
      return;
    }

    if (this.state === "entering") {
      // Float out through the giant door to her spot.
      if (this.timer <= 0) {
        const to = tmp.copy(this.home).sub(this.pos).setY(0);
        const d = to.length();
        if (d < 0.3) {
          this.state = "active";
          this.timer = 3;
          sfx.roar();
          ctx.awoke({ title: "Fire Rose!", subtitle: "The air turns hot and smells of roses…", image: "firerose.jpg" });
        } else {
          this.pos.addScaledVector(to.normalize(), Math.min(d, 3 * dt));
          this.pos.y = ctx.groundAt(this.pos.x, this.home.y, this.pos.z);
        }
      }
      this.yaw = lerpAngle(this.yaw, 0, Math.min(1, dt * 3));
    } else if (!ctx.isOver()) {
      const sees = ctx.canSee(eyes.set(this.pos.x, this.pos.y + HOVER + 3, this.pos.z), ctx.playerEye());
      if (this.state === "sleep" && ctx.inArena() && sees) {
        this.state = "active";
        this.timer = 3;
        sfx.roar();
        ctx.awoke({ title: "Fire Rose!", subtitle: "The air turns hot and smells of roses…", image: "firerose.jpg" });
      } else if (this.state === "active") {
        this.yaw = lerpAngle(this.yaw, Math.atan2(p.x - this.pos.x, p.z - this.pos.z), Math.min(1, dt * 3));
        this.think(dt, sees);
      }
    }

    this.updateBlooms(dt);
    this.updateRibbons(dt);
    this.pose(t, dt);
  }

  private pose(t: number, dt: number): void {
    const m = this.model;
    const charging = this.attack === "spiral" && this.ringsLeft > 0 && this.ringTimer > 0;
    this.spin += dt * (charging ? 9 : this.attack === "spiral" ? 5 : 0.6);
    m.roses.rotation.y = t * (this.attack === "spiral" ? 4 : 1.2);
    m.body.position.y = HOVER + Math.sin(t * 2) * 0.1;
    m.body.rotation.y = this.attack === "spiral" ? this.spin : 0;
    const flicker = 1 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.06;
    m.dress.forEach((mat, i) => {
      const [r, g, b] = DRESS[i]!;
      mat.color.setRGB(r * flicker, g * flicker, b);
    });
    m.group.visible = this.fade > 0.05 && this.state !== "dead";
    m.group.scale.setScalar(this.state === "dying" ? m.group.scale.x : Math.max(0.05, this.fade));
    m.group.position.copy(this.pos);
    m.group.rotation.y = this.yaw;
    this.ctx.tint(m, this.pos, this.hurt);
  }

  private think(dt: number, sees: boolean): void {
    const { ctx } = this;
    const angry = this.hp <= this.maxHp / 2;

    if (this.attack === "idle") {
      if (this.timer > 0) return;
      if (!ctx.inArena() || !sees) {
        this.timer = 0.5;
        return;
      }
      this.attacksMade++;
      // Once she's angry, every third attack is the Flame Ribbon.
      if (angry && this.attacksMade % 3 === 0) {
        this.attack = "ribbon";
        this.timer = 0.8;
        sfx.charge();
      } else if (this.next === "spiral") {
        this.attack = "spiral";
        this.ringsLeft = angry ? 3 : 2;
        this.ringTimer = 0.9;
        this.next = "bloom";
        sfx.charge();
      } else {
        this.attack = "bloom";
        this.startBlooms(angry ? 6 : 4);
        this.timer = BLOOM_WARN + 0.8;
        this.next = "spiral";
      }
    } else if (this.attack === "spiral") {
      this.ringTimer -= dt;
      if (this.ringTimer <= 0 && this.ringsLeft > 0) {
        this.fireRing();
        this.ringsLeft--;
        this.ringTimer = 0.5;
      }
      if (this.ringsLeft === 0 && this.ringTimer <= 0) this.toIdle(angry ? 1.4 : 2.2);
    } else if (this.attack === "bloom" && this.timer <= 0) {
      this.toIdle(angry ? 1.2 : 1.8);
    } else if (this.attack === "ribbon" && this.timer <= 0) {
      const ring = makeShockwave([2.8, 0.9, 0.15]);
      ring.group.position.copy(this.pos);
      ctx.gs.scene.add(ring.group);
      this.ribbons.push({ model: ring, center: this.pos.clone(), radius: 1, hit: false });
      sfx.fireball();
      ctx.hint("ribbon", "A ring of fire! JUMP over it! (Space)");
      this.toIdle(1.6);
    } else if (this.attack === "blink") {
      this.updateBlink(dt);
    }
  }

  private toIdle(wait: number): void {
    this.attack = "idle";
    this.timer = wait;
    if (this.hitsSinceBlink >= HITS_PER_BLINK) this.startBlink();
  }

  /** Rose Spiral: a ring of burning petals at the player's chest height, with gaps that shift each ring. */
  private fireRing(): void {
    const { ctx } = this;
    const y = ctx.player.pos.y + 1.1;
    const angry = this.hp <= this.maxHp / 2;
    for (let i = 0; i < PETALS_PER_RING; i++) {
      // Leave a gap of two petals so there's always a way through.
      if (i % 7 === 0) continue;
      const a = this.ringOffset + (i / PETALS_PER_RING) * Math.PI * 2;
      const dir = new Vector3(Math.sin(a), 0, Math.cos(a));
      const start = new Vector3(this.pos.x + dir.x * 1.2, y, this.pos.z + dir.z * 1.2);
      ctx.launch({ model: makeFirePetal(), pos: start, vel: dir.multiplyScalar(angry ? 7.5 : 6.5), gravity: 0, radius: 0.75, trail: FIRE, splat: ROSE, spin: 6 });
    }
    this.ringOffset += Math.PI / PETALS_PER_RING;
    sfx.fireball();
    ctx.hint("spiral", "Fire petals! Hold K to block them with your shield!");
  }

  /** Blooming Roses: buds sprout (one right under the player), then burst into fire. */
  private startBlooms(count: number): void {
    const { ctx } = this;
    const p = ctx.player.pos;
    const a0 = Math.random() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const a = a0 + (i / count) * Math.PI * 2;
      const r = i === 0 ? 0 : 2.5 + Math.random() * 3;
      const pos = new Vector3(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r);
      pos.y = ctx.groundAt(pos.x, p.y + 1, pos.z);
      const bud = makeRoseBud();
      bud.group.position.copy(pos);
      bud.group.scale.setScalar(0.1);
      const marker = makeMarker(2.2, [2.6, 0.9, 0.15]);
      marker.group.position.copy(pos);
      ctx.gs.scene.add(bud.group, marker.group);
      this.blooms.push({ bud, marker, pos, timer: BLOOM_WARN + i * 0.1, pillar: null, burn: 0 });
    }
    sfx.charge();
    ctx.hint("bloom", "Roses are blooming! Move away before they burst into fire!");
  }

  private updateBlooms(dt: number): void {
    const { ctx } = this;
    const p = ctx.player.pos;
    const pulse = 0.5 + Math.sin(performance.now() / 80) * 0.25;
    for (let i = this.blooms.length - 1; i >= 0; i--) {
      const b = this.blooms[i]!;
      b.timer -= dt;
      if (!b.pillar) {
        for (const mat of b.marker.glow) mat.opacity = pulse;
        b.bud.group.scale.setScalar(Math.min(1, 0.1 + (1 - Math.max(0, b.timer) / BLOOM_WARN) * 1.2));
        ctx.tint(b.bud, b.pos, 0);
        if (b.timer > 0) continue;
        // Burst into a pillar of fire.
        b.pillar = makeFirePillar();
        b.pillar.group.position.copy(b.pos);
        ctx.gs.scene.add(b.pillar.group);
        ctx.gs.scene.remove(b.bud.group, b.marker.group);
        b.burn = 0.7;
        sfx.slam();
        ctx.gs.burst(tmp.copy(b.pos).setY(b.pos.y + 1), FIRE, { count: 20, speed: 4, up: 9, gravity: 4, size: 0.2 });
        if (Math.hypot(p.x - b.pos.x, p.z - b.pos.z) < 1.25 && p.y < b.pos.y + 5) ctx.hurtPlayer(b.pos, false);
        continue;
      }
      b.burn -= dt;
      b.pillar.group.scale.set(1, Math.max(0.05, b.burn / 0.7), 1);
      if (b.burn <= 0) {
        ctx.gs.scene.remove(b.pillar.group);
        this.blooms.splice(i, 1);
      }
    }
  }

  private updateRibbons(dt: number): void {
    const p = this.ctx.player;
    for (let i = this.ribbons.length - 1; i >= 0; i--) {
      const r = this.ribbons[i]!;
      r.radius += RIBBON_SPEED * dt;
      r.model.pieces.forEach((piece, k) => {
        const a = (k / r.model.pieces.length) * Math.PI * 2 + r.radius * 0.3;
        piece.position.set(Math.cos(a) * r.radius, 0.25 + Math.sin(k * 2 + r.radius * 3) * 0.15, Math.sin(a) * r.radius);
      });
      if (Math.random() < 0.5) {
        const a = Math.random() * Math.PI * 2;
        tmp.set(r.center.x + Math.cos(a) * r.radius, r.center.y + 0.3, r.center.z + Math.sin(a) * r.radius);
        this.ctx.gs.burst(tmp, FIRE, { count: 1, speed: 0.5, up: 2, gravity: -1, life: 0.6, size: 0.14 });
      }
      const d = Math.hypot(p.pos.x - r.center.x, p.pos.z - r.center.z);
      if (!r.hit && Math.abs(d - r.radius) < 0.6 && p.pos.y < r.center.y + 0.7) {
        r.hit = true;
        this.ctx.hurtPlayer(r.center, false);
      }
      if (r.radius > RIBBON_MAX) {
        this.ctx.gs.scene.remove(r.model.group);
        this.ribbons.splice(i, 1);
      }
    }
  }

  /** Petal Blink: vanish in a swirl of petals and reappear somewhere else in the arena. */
  private startBlink(): void {
    const { ctx } = this;
    this.attack = "blink";
    this.timer = 1.4;
    this.hitsSinceBlink = 0;
    ctx.gs.burst(tmp.copy(this.pos).setY(this.pos.y + HOVER + 2), ROSE, { count: 40, speed: 6, up: 5, gravity: 2, size: 0.22, life: 1.2 });
    sfx.blink();
    const a = ctx.arena;
    const p = ctx.player.pos;
    for (let tries = 0; tries < 20; tries++) {
      const ang = Math.random() * Math.PI * 2;
      const e = 0.3 + Math.random() * 0.45;
      this.blinkTo.set(a.x + Math.cos(ang) * a.rx * e, 0, a.z + Math.sin(ang) * a.rz * e);
      if (Math.hypot(this.blinkTo.x - p.x, this.blinkTo.z - p.z) > 8) break;
    }
    this.blinkTo.y = ctx.groundAt(this.blinkTo.x, this.pos.y + 1, this.blinkTo.z);
    ctx.hint("blink", "She vanished in a swirl of petals! Find her!");
  }

  private updateBlink(dt: number): void {
    if (this.timer > 0.7) {
      this.fade = Math.max(0, this.fade - dt * 3);
      return;
    }
    if (this.fade <= 0.01 && !this.pos.equals(this.blinkTo)) {
      this.pos.copy(this.blinkTo);
      this.ctx.gs.burst(tmp.copy(this.pos).setY(this.pos.y + HOVER + 2), ROSE, { count: 30, speed: 5, up: 4, gravity: 2, size: 0.2 });
      sfx.blink();
    }
    this.fade = Math.min(1, this.fade + dt * 3);
    if (this.timer <= 0) {
      this.fade = 1;
      this.attack = "idle";
      this.timer = 0.8;
    }
  }

  private clearEffects(): void {
    const scene = this.ctx.gs.scene;
    for (const b of this.blooms) {
      scene.remove(b.bud.group, b.marker.group);
      if (b.pillar) scene.remove(b.pillar.group);
    }
    for (const r of this.ribbons) scene.remove(r.model.group);
    this.blooms = [];
    this.ribbons = [];
  }
}

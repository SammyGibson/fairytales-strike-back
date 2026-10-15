import { Vector3 } from "three";
import { makeBloodBox, makeFallingCube, makeMarker, makeMiniBox, makeShockwave, type BloodBoxModel, type Model } from "../models";
import { sfx } from "../sound";
import type { Boss, BossContext, BossState } from "./boss";

const tmp = new Vector3();
const eyes = new Vector3();

const RED: [number, number, number] = [200, 30, 44];
const SLAM_AIR = 1.1;
const RING_SPEED = 7.5;
const RING_MAX = 15;
const RAIN_WARN = 1.4;
const MAX_MINIS = 6;

type Mini = { model: Model; pos: Vector3; vel: Vector3; hop: number; hurt: number };
type Drop = { model: Model; marker: Model; target: Vector3; timer: number; y: number };
type Ring = { model: ReturnType<typeof makeShockwave>; center: Vector3; radius: number; hit: boolean };

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Level 2, second boss: the Blood Box, a giant red jelly cube.
 * - Cube Rain: its floating cubes drop where glowing squares appear (move away).
 * - Jelly Slam: it leaps, lands on a marked spot and sends out a goo ring (jump over it).
 * - Mini Boxes: at half and quarter health it spits out little hopping cubes (one hit each).
 */
export class BloodBoxBoss implements Boss {
  readonly name = "The Blood Box";
  readonly maxHp = 14;
  readonly radius = 2.4;
  hp = this.maxHp;
  state: BossState = "sleep";
  readonly pos: Vector3;

  private readonly model: BloodBoxModel;
  private attack: "idle" | "crouch" | "air" | "rain" | "spit" = "idle";
  private nextAttack: "slam" | "rain" = "slam";
  private yaw = 0;
  private timer = 0;
  private hurt = 0;
  private hopTimer = 0;
  private hopFrom = new Vector3();
  private hopTo = new Vector3();
  private hopTime = 0;
  private hopDuration = 0;
  private hopHeight = 0;
  private landMarker: Model | null = null;
  private spitsDone = 0;
  private minis: Mini[] = [];
  private drops: Drop[] = [];
  private rings: Ring[] = [];

  constructor(private readonly ctx: BossContext, private readonly home: Vector3) {
    this.pos = home.clone();
    this.model = makeBloodBox();
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
    this.spitsDone = 0;
    this.hopDuration = 0;
    this.model.group.visible = true;
    this.model.group.scale.setScalar(1);
  }

  dispose(): void {
    this.clearEffects();
    this.ctx.gs.scene.remove(this.model.group);
  }

  emerge(from: Vector3): void {
    this.reset();
    this.pos.copy(from);
    this.state = "entering";
    // Wait for the door to swing open first.
    this.hopTimer = 1.6;
  }

  swordHit(reaches: (pos: Vector3, radius: number) => boolean, power: number): boolean {
    let hit = false;
    for (let i = this.minis.length - 1; i >= 0; i--) {
      const m = this.minis[i]!;
      if (!reaches(m.pos, 0.4)) continue;
      hit = true;
      this.popMini(i);
    }
    if (this.state === "active" && reaches(this.pos, this.radius)) {
      hit = true;
      this.damage(power);
    }
    return hit;
  }

  private damage(power: number): void {
    this.hp = Math.max(0, this.hp - power);
    this.hurt = 0.25;
    sfx.bossHurt();
    sfx.squish();
    const p = this.ctx.player.pos;
    this.ctx.gs.burst(tmp.copy(p).lerp(this.pos, 0.55).setY(this.pos.y + 2), RED, { count: 16, speed: 5 });
    this.ctx.healthChanged();
    if (this.hp <= 0) {
      this.state = "dying";
      this.timer = 1.6;
      sfx.roar();
      this.clearEffects();
      this.ctx.clearProjectiles();
    }
  }

  update(dt: number): void {
    const { ctx, model: m } = this;
    if (this.state === "dead") return;
    const p = ctx.player.pos;
    this.hurt = Math.max(0, this.hurt - dt);
    this.timer -= dt;
    const t = performance.now() / 1000;

    // Goo dripping off it.
    if (Math.random() < dt * 10) {
      tmp.set(this.pos.x + (Math.random() - 0.5) * 4.4, this.pos.y + 0.5 + Math.random() * 3, this.pos.z + (Math.random() - 0.5) * 4.4);
      ctx.gs.burst(tmp, [230, 40, 56], { count: 1, speed: 0.2, up: -0.3, gravity: 9, life: 0.7, size: 0.12, spread: 0.2 });
    }

    if (this.state === "dying") {
      const k = Math.max(0, this.timer / 1.6);
      m.group.scale.set(1 + (1 - k) * 0.3, k, 1 + (1 - k) * 0.3);
      if (Math.random() < 0.6) ctx.gs.burst(tmp.copy(this.pos).setY(this.pos.y + 3 * k + 0.5), RED, { count: 3, speed: 8, up: 6, size: 0.3 });
      if (this.timer <= 0) {
        this.state = "dead";
        m.group.visible = false;
        ctx.gs.burst(tmp.copy(this.pos).setY(this.pos.y + 1.5), RED, { count: 80, speed: 11, up: 8, size: 0.32 });
        ctx.defeated();
      }
      ctx.tint(m, this.pos, 0);
      return;
    }

    this.updateHop(dt);
    const dist = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);

    if (this.state === "entering") {
      // Hop out through the giant door to its spot in the arena.
      if (this.hopDuration <= 0) {
        this.hopTimer -= dt;
        if (this.hopTimer <= 0) {
          if (Math.hypot(this.home.x - this.pos.x, this.home.z - this.pos.z) < 0.5) {
            this.state = "active";
            this.timer = 3;
            sfx.roar();
            ctx.awoke({ title: "The Blood Box!", subtitle: "Something squelches behind the door…", image: "bloodbox.jpg" });
          } else {
            const step = tmp.copy(this.home).sub(this.pos).setY(0);
            if (step.length() > 3) step.setLength(3);
            this.startHop(step.add(this.pos), 2, 0.7);
            this.hopTimer = 0.25;
          }
        }
      }
      this.yaw = lerpAngle(this.yaw, 0, Math.min(1, dt * 3));
    } else if (!ctx.isOver()) {
      const sees = ctx.canSee(eyes.set(this.pos.x, this.pos.y + 3.2, this.pos.z), ctx.playerEye());
      if (this.state === "sleep" && ctx.inArena() && sees) {
        this.state = "active";
        this.timer = 3;
        sfx.roar();
        ctx.awoke({ title: "The Blood Box!", subtitle: "Something squelches behind the door…", image: "bloodbox.jpg" });
      } else if (this.state === "active") {
        this.yaw = lerpAngle(this.yaw, Math.atan2(p.x - this.pos.x, p.z - this.pos.z), Math.min(1, dt * 2.5));
        this.think(dt, dist, sees);
      }
    }

    this.updateMinis(dt);
    this.updateDrops(dt);
    this.updateRings(dt);

    // Animation: wobbling jelly, squashing before a leap, orbiting cubes, swaying tentacles.
    const crouch = this.attack === "crouch" ? Math.min(1, (0.7 - this.timer) / 0.5) : 0;
    const wobble = Math.sin(t * 5) * 0.03;
    const airStretch = this.attack === "air" ? 0.12 : 0;
    m.body.scale.set(1 + crouch * 0.18 - wobble, 1 - crouch * 0.25 + wobble + airStretch, 1 + crouch * 0.18 - wobble);
    m.orbit.rotation.y = t * 0.8;
    m.orbit.visible = this.attack !== "rain";
    m.tentacles.forEach((arm, i) => (arm.rotation.z = Math.sin(t * 2 + i * 2) * 0.25));
    m.group.position.copy(this.pos);
    m.group.rotation.y = this.yaw;
    ctx.tint(m, this.pos, this.hurt);
  }

  /** Chooses and runs attacks while active. */
  private think(dt: number, dist: number, sees: boolean): void {
    const { ctx } = this;
    const p = ctx.player.pos;
    const angry = this.hp <= this.maxHp / 2;

    if (this.attack === "idle") {
      // Shuffle closer with little hops between attacks.
      this.hopTimer -= dt;
      if (this.hopTimer <= 0 && this.hopDuration <= 0 && dist > 7) {
        const step = tmp.set(p.x - this.pos.x, 0, p.z - this.pos.z).normalize().multiplyScalar(2.2).add(this.pos);
        this.startHop(step, 2.2, 1);
        this.hopTimer = 1.1;
      } else if (this.hopTimer <= 0 && this.hopDuration <= 0 && dist < 4.5) {
        // Too close to see properly: bounce back a little.
        const step = tmp.set(this.pos.x - p.x, 0, this.pos.z - p.z).normalize().multiplyScalar(3).add(this.pos);
        this.keepInArena(step);
        this.startHop(step, 1.8, 0.8);
        this.hopTimer = 2.5;
      }
      const spitDue = (this.spitsDone === 0 && this.hp <= this.maxHp / 2) || (this.spitsDone === 1 && this.hp <= this.maxHp / 4);
      if (this.timer <= 0 && this.hopDuration <= 0 && ctx.inArena() && sees) {
        if (spitDue) {
          this.attack = "spit";
          this.timer = 0.8;
          this.spitsDone++;
        } else if (this.nextAttack === "slam") {
          this.attack = "crouch";
          this.timer = 0.7;
          this.nextAttack = "rain";
        } else {
          this.startRain(angry ? 8 : 5);
          this.attack = "rain";
          this.timer = RAIN_WARN + 1;
          this.nextAttack = "slam";
        }
      } else if (this.timer <= 0) {
        this.timer = 0.5;
      }
    } else if (this.attack === "crouch" && this.timer <= 0) {
      // Leap at where the player is standing now; a marker shows the landing spot.
      const target = new Vector3(p.x, 0, p.z);
      const away = tmp.copy(target).sub(this.pos).setY(0);
      if (away.length() > 9) target.copy(this.pos).add(away.setLength(9));
      this.keepInArena(target);
      target.y = ctx.groundAt(target.x, this.pos.y + 1, target.z);
      this.landMarker = makeMarker(this.radius * 2);
      this.landMarker.group.position.copy(target);
      ctx.gs.scene.add(this.landMarker.group);
      this.startHop(target, 6, SLAM_AIR);
      this.attack = "air";
      ctx.hint("slam", "Run from the red square, then JUMP over the ring! (Space)");
    } else if (this.attack === "rain" && this.timer <= 0) {
      this.attack = "idle";
      this.timer = angry ? 1.6 : 2.4;
    } else if (this.attack === "spit" && this.timer <= 0) {
      for (let i = 0; i < 3 && this.minis.length < MAX_MINIS; i++) this.spawnMini(i);
      sfx.squish();
      ctx.hint("minis", "Pop the little boxes with your sword!");
      this.attack = "idle";
      this.timer = 2;
    }
  }

  /** Pulls a landing spot well inside the arena wall. */
  private keepInArena(target: Vector3): void {
    const a = this.ctx.arena;
    const dx = (target.x - a.x) / a.rx;
    const dz = (target.z - a.z) / a.rz;
    const e = Math.hypot(dx, dz);
    if (e > 0.75) {
      target.x = a.x + (dx / e) * 0.75 * a.rx;
      target.z = a.z + (dz / e) * 0.75 * a.rz;
    }
  }

  private startHop(to: Vector3, height: number, duration: number): void {
    this.hopFrom.copy(this.pos);
    this.hopTo.copy(to);
    this.hopTo.y = this.ctx.groundAt(to.x, this.pos.y + 1, to.z);
    this.hopHeight = height;
    this.hopDuration = duration;
    this.hopTime = 0;
  }

  private updateHop(dt: number): void {
    if (this.hopDuration <= 0) return;
    this.hopTime += dt;
    const k = Math.min(1, this.hopTime / this.hopDuration);
    this.pos.lerpVectors(this.hopFrom, this.hopTo, k);
    this.pos.y += Math.sin(k * Math.PI) * this.hopHeight;
    if (k < 1) return;
    this.hopDuration = 0;
    this.pos.copy(this.hopTo);
    if (this.attack === "air") this.land();
    else {
      sfx.squish();
      this.ctx.gs.burst(tmp.copy(this.pos).setY(this.pos.y + 0.2), RED, { count: 8, speed: 3, up: 1.5, size: 0.14 });
    }
  }

  /** The Jelly Slam lands: squash anyone underneath and send out a goo ring. */
  private land(): void {
    const { ctx } = this;
    sfx.slam();
    if (this.landMarker) {
      ctx.gs.scene.remove(this.landMarker.group);
      this.landMarker = null;
    }
    ctx.gs.burst(tmp.copy(this.pos).setY(this.pos.y + 0.3), RED, { count: 30, speed: 9, up: 4, size: 0.2 });
    const p = ctx.player.pos;
    if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < this.radius + 0.6) ctx.hurtPlayer(this.pos, false);
    const ring = makeShockwave();
    ring.group.position.copy(this.pos);
    ctx.gs.scene.add(ring.group);
    this.rings.push({ model: ring, center: this.pos.clone(), radius: this.radius, hit: false });
    this.attack = "idle";
    this.timer = this.hp <= this.maxHp / 2 ? 1.8 : 2.6;
  }

  private updateRings(dt: number): void {
    const p = this.ctx.player;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.radius += RING_SPEED * dt;
      r.model.pieces.forEach((piece, k) => {
        const a = (k / r.model.pieces.length) * Math.PI * 2;
        piece.position.set(Math.cos(a) * r.radius, 0.2 + Math.sin(k * 3 + r.radius * 2) * 0.1, Math.sin(a) * r.radius);
      });
      const d = Math.hypot(p.pos.x - r.center.x, p.pos.z - r.center.z);
      // Only hurts players standing on the ground as it passes: jumping clears it.
      if (!r.hit && Math.abs(d - r.radius) < 0.6 && p.pos.y < r.center.y + 0.7) {
        r.hit = true;
        this.ctx.hurtPlayer(r.center, false);
      }
      if (r.radius > RING_MAX) {
        this.ctx.gs.scene.remove(r.model.group);
        this.rings.splice(i, 1);
      }
    }
  }

  /** Cube Rain: marks spots on the ground, then drops a cube on each. */
  private startRain(count: number): void {
    const { ctx } = this;
    const p = ctx.player.pos;
    sfx.charge();
    ctx.gs.burst(tmp.copy(this.pos).setY(this.pos.y + 5.6), RED, { count: 20, speed: 3, up: 12, gravity: 0, size: 0.3, life: 0.8 });
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = i === 0 ? 0 : 1.8 + Math.random() * 4;
      const target = new Vector3(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r);
      target.y = ctx.groundAt(target.x, p.y + 1, target.z);
      const marker = makeMarker(1.6);
      marker.group.position.copy(target);
      ctx.gs.scene.add(marker.group);
      const model = makeFallingCube();
      model.group.visible = false;
      ctx.gs.scene.add(model.group);
      this.drops.push({ model, marker, target, timer: RAIN_WARN + i * 0.12, y: target.y + 16 });
    }
    ctx.hint("rain", "Cube Rain! Step off the red squares!");
  }

  private updateDrops(dt: number): void {
    const { ctx } = this;
    const p = ctx.player.pos;
    const pulse = 0.55 + Math.sin(performance.now() / 90) * 0.25;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;
      d.timer -= dt;
      for (const mat of d.marker.glow) mat.opacity = pulse;
      if (d.timer > 0.45) continue;
      // Falling.
      d.model.group.visible = true;
      d.y = d.target.y + Math.max(0, d.timer / 0.45) * 16;
      d.model.group.position.set(d.target.x, d.y + 0.45, d.target.z);
      d.model.group.rotation.y += dt * 6;
      ctx.tint(d.model, d.target, 0);
      if (d.timer > 0) continue;
      sfx.splat();
      ctx.gs.burst(tmp.copy(d.target).setY(d.target.y + 0.4), RED, { count: 14, speed: 5, up: 4, size: 0.16 });
      if (Math.hypot(p.x - d.target.x, p.z - d.target.z) < 1.15 && p.y < d.target.y + 2) ctx.hurtPlayer(d.target, false);
      ctx.gs.scene.remove(d.model.group, d.marker.group);
      this.drops.splice(i, 1);
    }
  }

  private spawnMini(i: number): void {
    const model = makeMiniBox();
    const a = this.yaw + (i - 1) * 0.6;
    const pos = new Vector3(this.pos.x + Math.sin(a) * 2.6, this.pos.y + 1.5, this.pos.z + Math.cos(a) * 2.6);
    model.group.position.copy(pos);
    this.ctx.gs.scene.add(model.group);
    this.minis.push({ model, pos, vel: new Vector3(Math.sin(a) * 4, 5, Math.cos(a) * 4), hop: 0.6 + i * 0.2, hurt: 0 });
  }

  private popMini(index: number): void {
    const mini = this.minis[index]!;
    sfx.squish();
    this.ctx.gs.burst(tmp.copy(mini.pos).setY(mini.pos.y + 0.4), RED, { count: 14, speed: 4, up: 3, size: 0.12 });
    this.ctx.gs.scene.remove(mini.model.group);
    this.minis.splice(index, 1);
  }

  private updateMinis(dt: number): void {
    const { ctx } = this;
    const p = ctx.player.pos;
    for (const mini of this.minis) {
      mini.hop -= dt;
      mini.hurt = Math.max(0, mini.hurt - dt);
      const ground = ctx.groundAt(mini.pos.x, mini.pos.y, mini.pos.z);
      const onGround = mini.pos.y <= ground + 0.01;
      if (onGround) {
        mini.pos.y = ground;
        mini.vel.set(0, 0, 0);
        if (mini.hop <= 0 && !ctx.isOver()) {
          // Hop at the player, but only from where they can see it.
          const toward = tmp.set(p.x - mini.pos.x, 0, p.z - mini.pos.z);
          const len = toward.length();
          if (len > 0.9) {
            toward.normalize();
            if (ctx.facing(mini.pos) < 0.2 && len < 4) {
              // Behind the player: hop round to their front instead.
              const yaw = ctx.player.yaw;
              toward.set(p.x - Math.sin(yaw) * 2 - mini.pos.x, 0, p.z - Math.cos(yaw) * 2 - mini.pos.z).normalize();
            }
            mini.vel.set(toward.x * 3, 4.5, toward.z * 3);
          }
          mini.hop = 0.7 + Math.random() * 0.3;
        }
      } else {
        mini.vel.y -= 16 * dt;
      }
      const nx = mini.pos.x + mini.vel.x * dt;
      const nz = mini.pos.z + mini.vel.z * dt;
      if (ctx.groundAt(nx, mini.pos.y, nz) - mini.pos.y < 1.1) {
        mini.pos.x = nx;
        mini.pos.z = nz;
      }
      mini.pos.y = Math.max(ctx.groundAt(mini.pos.x, mini.pos.y, mini.pos.z), mini.pos.y + mini.vel.y * dt);

      const d = Math.hypot(p.x - mini.pos.x, p.z - mini.pos.z);
      if (d < 1 && Math.abs(p.y - mini.pos.y) < 1.2 && mini.hurt <= 0 && ctx.facing(mini.pos) > 0.3) {
        mini.hurt = 1;
        if (ctx.hurtPlayer(mini.pos, true)) {
          tmp.set(mini.pos.x - p.x, 0, mini.pos.z - p.z).normalize();
          mini.vel.set(tmp.x * 5, 4, tmp.z * 5);
        }
      }
      mini.model.group.position.copy(mini.pos);
      mini.model.group.rotation.y = Math.atan2(p.x - mini.pos.x, p.z - mini.pos.z);
      const squash = onGround ? 0.85 : 1.1;
      mini.model.group.scale.set(1 / squash, squash, 1 / squash);
      ctx.tint(mini.model, mini.pos, 0);
    }
  }

  private clearEffects(): void {
    const scene = this.ctx.gs.scene;
    for (const m of this.minis) scene.remove(m.model.group);
    for (const d of this.drops) scene.remove(d.model.group, d.marker.group);
    for (const r of this.rings) scene.remove(r.model.group);
    if (this.landMarker) scene.remove(this.landMarker.group);
    this.minis = [];
    this.drops = [];
    this.rings = [];
    this.landMarker = null;
  }
}

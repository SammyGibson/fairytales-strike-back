import { Vector3 } from "three";
import { makeFireball, makeSam, type SamModel } from "../models";
import { sfx } from "../sound";
import type { Boss, BossContext, BossState } from "./boss";

const tmp = new Vector3();
const head = new Vector3();
const hand = new Vector3();

const WALK_SPEED = 1.4;
const WINDUP = 1.1;
const SHOT_GAP = 0.16;

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Level 2, first boss: Sam the Bad Man. He stomps after the player and, between
 * steps, raises all six arms and fires a fireball from each hand in turn.
 * Every fireball can be blocked with the shield.
 */
export class SamBoss implements Boss {
  readonly name = "Sam the Bad Man";
  readonly maxHp = 12;
  readonly radius = 1.8;
  hp = this.maxHp;
  state: BossState = "sleep";
  readonly pos: Vector3;

  private readonly model: SamModel;
  private attack: "walk" | "windup" | "fire" = "walk";
  private yaw = 0;
  private timer = 0;
  private hurt = 0;
  private walk = 0;
  private lastStep = 0;
  private shotsFired = 0;
  private fall = 0;

  constructor(private readonly ctx: BossContext, private readonly home: Vector3) {
    this.pos = home.clone();
    this.model = makeSam();
    ctx.gs.scene.add(this.model.group);
  }

  reset(): void {
    this.pos.copy(this.home);
    this.hp = this.maxHp;
    this.state = "sleep";
    this.attack = "walk";
    this.timer = 0;
    this.hurt = 0;
    this.fall = 0;
    this.yaw = 0;
    this.model.group.visible = true;
    this.model.group.rotation.set(0, 0, 0);
  }

  dispose(): void {
    this.ctx.gs.scene.remove(this.model.group);
  }

  swordHit(reaches: (pos: Vector3, radius: number) => boolean, power: number): boolean {
    if (this.state !== "active" || !reaches(this.pos, this.radius)) return false;
    this.damage(power);
    return true;
  }

  private damage(power: number): void {
    this.hp = Math.max(0, this.hp - power);
    this.hurt = 0.25;
    sfx.bossHurt();
    const p = this.ctx.player.pos;
    this.ctx.gs.burst(tmp.copy(p).lerp(this.pos, 0.6).setY(this.pos.y + 3), [120, 190, 60], { count: 14, speed: 5 });
    this.ctx.healthChanged();
    if (this.hp <= 0) {
      this.state = "dying";
      this.timer = 1.8;
      sfx.roar();
      this.ctx.clearProjectiles();
    }
  }

  update(dt: number): void {
    const { ctx, model: m } = this;
    if (this.state === "dead") return;
    const p = ctx.player.pos;
    this.hurt = Math.max(0, this.hurt - dt);
    this.timer -= dt;

    // Glowing slime dripping from his hands.
    if (Math.random() < dt * 8) {
      const arm = m.arms[Math.floor(Math.random() * m.arms.length)]!;
      arm.hand.getWorldPosition(hand);
      ctx.gs.burst(hand, [150, 240, 70], { count: 1, speed: 0.3, up: -0.5, gravity: 6, life: 0.8, size: 0.12, spread: 0.3 });
    }

    if (this.state === "dying") {
      this.fall = Math.min(1, this.fall + dt * 0.9);
      m.group.rotation.x = -this.fall * (Math.PI / 2) * 0.9;
      m.group.position.copy(this.pos);
      if (Math.random() < 0.5) ctx.gs.burst(tmp.copy(this.pos).setY(this.pos.y + 3 * (1 - this.fall) + 1), [120, 190, 60], { count: 3, speed: 7, up: 5, size: 0.24 });
      if (this.timer <= 0) {
        this.state = "dead";
        m.group.visible = false;
        ctx.gs.burst(tmp.copy(this.pos).setY(this.pos.y + 1.5), [150, 240, 70], { count: 70, speed: 10, up: 7, size: 0.26 });
        ctx.gs.burst(tmp, [255, 150, 40], { count: 30, speed: 8, up: 6, size: 0.2 });
        ctx.defeated();
      }
      ctx.tint(m, this.pos, 0);
      return;
    }

    const sees = ctx.canSee(head.set(this.pos.x, this.pos.y + 6.2, this.pos.z), ctx.playerEye());
    const inArena = ctx.inArena();
    const dist = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    const angry = this.hp <= this.maxHp / 2;
    let moving = false;

    if (!ctx.isOver()) {
      if (this.state === "sleep" && inArena && sees) {
        this.state = "active";
        this.timer = 3;
        sfx.roar();
        ctx.awoke({ title: "Sam the Bad Man!", subtitle: "The crowd goes silent…", image: "sam.jpg" });
      } else if (this.state === "active") {
        if (this.attack === "walk") {
          if (dist > 4.5) moving = this.step(dt, p);
          if (this.timer <= 0) {
            if (inArena && sees) {
              this.attack = "windup";
              this.timer = WINDUP;
              sfx.charge();
            } else {
              this.timer = 0.5;
            }
          }
        } else if (this.attack === "windup" && this.timer <= 0) {
          this.attack = "fire";
          this.shotsFired = 0;
          this.timer = 0;
        } else if (this.attack === "fire" && this.timer <= 0) {
          this.fireFrom(this.shotsFired, angry);
          this.shotsFired++;
          this.timer = SHOT_GAP;
          if (this.shotsFired >= m.arms.length) {
            this.attack = "walk";
            this.timer = angry ? 2 : 2.8;
          }
        }
      }
    }
    if (this.state === "active") this.yaw = lerpAngle(this.yaw, Math.atan2(p.x - this.pos.x, p.z - this.pos.z), Math.min(1, dt * 2.2));

    // Animation: stomping legs, swaying arms that raise and point forward to fire.
    if (moving) this.walk += dt * 4;
    const swing = moving ? Math.sin(this.walk) * 0.4 : 0;
    m.leftLeg.rotation.x = swing;
    m.rightLeg.rotation.x = -swing;
    const charge = this.attack === "windup" ? Math.min(1, (WINDUP - this.timer) / (WINDUP * 0.7)) : this.attack === "fire" ? 1 : 0;
    const t = performance.now() / 1000;
    m.arms.forEach((arm, i) => {
      const wave = Math.sin(t * 2 + i) * 0.12;
      arm.pivot.rotation.z = arm.side * (arm.lift * (1 - charge * 0.6) + wave);
      arm.pivot.rotation.y = -arm.side * (0.25 + charge * 0.9);
    });
    // Hands glow softly at rest and blaze while he charges up a volley.
    const glow = 0.45 + charge * 1.3 + Math.sin(t * 6) * 0.08;
    m.handGlow.color.setRGB(1.2 * glow, 3 * glow, 0.4 * glow);
    m.body.rotation.z = Math.sin(this.walk * 0.5) * 0.04;
    m.group.position.copy(this.pos);
    m.group.rotation.y = this.yaw;
    ctx.tint(m, this.pos, this.hurt);
  }

  /** Walks towards the player, staying on the ground and inside the arena. Returns true if he moved. */
  private step(dt: number, target: Vector3): boolean {
    const dx = target.x - this.pos.x;
    const dz = target.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const nx = this.pos.x + (dx / d) * WALK_SPEED * dt;
    const nz = this.pos.z + (dz / d) * WALK_SPEED * dt;
    const g = this.ctx.groundAt(nx, this.pos.y, nz);
    if (g - this.pos.y > 1.2) return false;
    this.pos.set(nx, g, nz);
    if (Math.floor(this.walk / Math.PI) !== this.lastStep) {
      this.lastStep = Math.floor(this.walk / Math.PI);
      sfx.stomp();
      this.ctx.gs.burst(tmp.copy(this.pos).setY(this.pos.y + 0.1), [200, 180, 140], { count: 6, speed: 3, up: 1.5, size: 0.12 });
    }
    return true;
  }

  private fireFrom(index: number, angry: boolean): void {
    const arm = this.model.arms[index % this.model.arms.length]!;
    this.model.group.updateMatrixWorld(true);
    const start = arm.hand.getWorldPosition(new Vector3());
    const p = this.ctx.player.pos;
    const target = new Vector3(p.x + (Math.random() - 0.5) * 0.8, p.y + 1.1 + (Math.random() - 0.5) * 0.4, p.z + (Math.random() - 0.5) * 0.8);
    const vel = target.sub(start).normalize().multiplyScalar(angry ? 12 : 10);
    this.ctx.launch({ model: makeFireball(), pos: start, vel, gravity: 0, radius: 0.9, trail: [255, 150, 40], splat: [255, 120, 30], spin: 8 });
    sfx.fireball();
  }
}

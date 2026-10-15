import { Vector3 } from "three";
import { makePotatoBoss, makeRottenSpud, makeStone, type Model, type PotatoModel } from "../models";
import { sfx } from "../sound";
import type { Boss, BossContext, BossState } from "./boss";

const tmp = new Vector3();
const head = new Vector3();

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Level 1 boss: wakes in her arena and throws big stones the player can block. */
export class PotatoBoss implements Boss {
  readonly name = "The Rotten Potato";
  readonly maxHp = 10;
  readonly radius = 2.5;
  hp = this.maxHp;
  state: BossState = "sleep";
  readonly pos: Vector3;

  private readonly model: PotatoModel;
  private readonly heldStone: Model;
  private readonly spuds: { model: Model; pos: Vector3 }[];
  private attack: "wait" | "windup" = "wait";
  private yaw = 0;
  private timer = 0;
  private hurt = 0;
  private stink = 0;

  constructor(private readonly ctx: BossContext, private readonly home: Vector3) {
    this.pos = home.clone();
    this.model = makePotatoBoss();
    ctx.gs.scene.add(this.model.group);

    // The stone she lifts over her head before each throw, so players see it coming.
    this.heldStone = makeStone();
    this.heldStone.group.position.set(0, 5.4, 0.3);
    this.heldStone.group.scale.setScalar(1.3);
    this.heldStone.group.visible = false;
    this.model.body.add(this.heldStone.group);

    this.spuds = [0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      const pos = new Vector3(home.x + Math.cos(a) * 3.6, 0, home.z + Math.sin(a) * 3.2);
      pos.y = ctx.groundAt(pos.x, home.y + 2, pos.z);
      const model = makeRottenSpud();
      model.group.position.copy(pos);
      model.group.rotation.y = a * 3;
      ctx.gs.scene.add(model.group);
      return { model, pos };
    });
  }

  reset(): void {
    this.pos.copy(this.home);
    this.hp = this.maxHp;
    this.state = "sleep";
    this.attack = "wait";
    this.timer = 0;
    this.hurt = 0;
    this.model.group.visible = true;
    this.model.group.scale.setScalar(1);
  }

  dispose(): void {
    this.ctx.gs.scene.remove(this.model.group);
    for (const s of this.spuds) this.ctx.gs.scene.remove(s.model.group);
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
    this.ctx.gs.burst(tmp.copy(p).lerp(this.pos, 0.6).setY(this.pos.y + 1.8), [206, 170, 108], { count: 14, speed: 5 });
    this.ctx.healthChanged();
    if (this.hp <= 0) {
      this.state = "dying";
      this.timer = 1.6;
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

    // Stink clouds rising from her and her little rotten potatoes.
    this.stink -= dt;
    if (this.stink <= 0) {
      this.stink = 0.09;
      const src =
        Math.random() < 0.4
          ? tmp.copy(this.pos).setY(this.pos.y + 4.6)
          : tmp.copy(this.spuds[Math.floor(Math.random() * this.spuds.length)]!.pos).setY(this.pos.y + 0.6);
      ctx.gs.burst(src, [190, 214, 70], { count: 1, speed: 0.6, up: 1.4, gravity: -0.6, life: 1.8, size: 0.22, spread: 0.5 });
    }

    if (this.state === "dying") {
      const t = Math.max(0, this.timer / 1.6);
      m.group.scale.set(1 + (1 - t) * 0.25, t, 1 + (1 - t) * 0.25);
      if (Math.random() < 0.5) ctx.gs.burst(tmp.copy(this.pos).setY(this.pos.y + 2 * t + 0.5), [206, 170, 108], { count: 3, speed: 7, up: 5, size: 0.24 });
      if (this.timer <= 0) {
        this.state = "dead";
        m.group.visible = false;
        ctx.gs.burst(tmp.copy(this.pos).setY(this.pos.y + 1), [200, 220, 80], { count: 60, speed: 9, up: 6, size: 0.25 });
        ctx.defeated();
      }
      ctx.tint(m, this.pos, 0);
      return;
    }

    // She only wakes once you're inside her arena, and only throws while she can see you.
    const sees = ctx.canSee(head.set(this.pos.x, this.pos.y + 3.4, this.pos.z), ctx.playerEye());
    const inArena = ctx.inArena();
    if (!ctx.isOver()) {
      if (this.state === "sleep" && inArena && sees) {
        this.state = "active";
        this.timer = 2.8;
        sfx.roar();
        ctx.awoke({ title: "The Rotten Potato!", subtitle: "A stinky smell fills the air…", image: "potato.jpg" });
      } else if (this.state === "active" && this.attack === "wait" && this.timer <= 0) {
        if (inArena && sees) {
          this.attack = "windup";
          this.timer = 0.9;
        } else {
          this.timer = 0.5;
        }
      } else if (this.attack === "windup" && this.timer <= 0) {
        this.throwStone();
        this.attack = "wait";
        this.timer = this.hp <= 5 ? 1.9 : 2.6;
      }
    }
    this.heldStone.group.visible = this.attack === "windup";
    if (this.attack === "windup") ctx.tint(this.heldStone, this.pos, 0);
    if (this.state === "active") this.yaw = lerpAngle(this.yaw, Math.atan2(p.x - this.pos.x, p.z - this.pos.z), Math.min(1, dt * 2.5));

    const breathe = Math.sin(performance.now() / 400) * 0.03;
    m.body.scale.set(1 - breathe, 1 + breathe, 1 - breathe);
    m.body.rotation.x =
      this.attack === "windup" ? -0.2 * Math.min(1, (0.9 - this.timer) / 0.6) : Math.max(0, m.body.rotation.x - dt * 2);
    m.group.position.copy(this.pos);
    m.group.rotation.y = this.yaw;
    ctx.tint(m, this.pos, this.hurt);
    for (const s of this.spuds) ctx.tint(s.model, s.pos, 0);
  }

  private throwStone(): void {
    const p = this.ctx.player.pos;
    const start = new Vector3(this.pos.x + Math.sin(this.yaw) * 1.2, this.pos.y + 5.2, this.pos.z + Math.cos(this.yaw) * 1.2);
    const target = new Vector3(p.x, p.y + 1.1, p.z);
    const T = Math.min(1.8, Math.max(1, start.distanceTo(target) / 8));
    const g = 14;
    const vel = new Vector3((target.x - start.x) / T, (target.y - start.y) / T + 0.5 * g * T, (target.z - start.z) / T);
    this.ctx.launch({ model: makeStone(), pos: start, vel, gravity: g, radius: 1, trail: [140, 138, 146], splat: [150, 148, 156], spin: 4 });
    this.model.body.rotation.x = 0.25;
    sfx.throw();
  }
}

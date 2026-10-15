import { type Color, Vector3 } from "three";
import { B, BLOCKS, isOpaque } from "./blocks";
import { buildLevel1, type Level } from "./level1";
import { makeHeart, makePotatoBoss, makeRottenSpud, makeShield, makeStone, makeSword, makeZombie, type Model, type PotatoModel, type ZombieModel } from "./models";
import { EYE_HEIGHT, Player, type MoveInput } from "./player";
import type { SaveData } from "./save";
import type { GameScene } from "./scene";
import { sfx } from "./sound";
import type { World } from "./world";

export const MAX_HEARTS = 6;
const BOSS_MAX_HP = 10;
const ZOMBIE_HP = 2;
const BOSS_RADIUS = 2.5;
const SWORD_REACH = 2.7;
const ATTACK_COOLDOWN = 0.38;
const SWING_TIME = 0.3;
/** Moonlight on characters, in sRGB terms (a touch brighter than the terrain so enemies read well). */
const CHAR_AMBIENT = [0.46, 0.5, 0.74] as const;

export type GameEvents = {
  health(hearts: number): void;
  boss(hp: number | null, max: number): void;
  bossIntro(): void;
  hurt(): void;
  toast(message: string): void;
  checkpoint(): void;
  died(): void;
  won(): void;
};

export type FrameInput = {
  move: MoveInput;
  blocking: boolean;
};

type ZombieState = "idle" | "chase" | "windup" | "recover" | "dying" | "dead";

type Zombie = {
  id: number;
  model: ZombieModel;
  home: Vector3;
  pos: Vector3;
  yaw: number;
  hp: number;
  state: ZombieState;
  timer: number;
  hurt: number;
  knock: Vector3;
  walk: number;
  groan: number;
};

type BossState = "sleep" | "idle" | "windup" | "dying" | "dead";

type Boss = {
  model: PotatoModel;
  home: Vector3;
  pos: Vector3;
  yaw: number;
  hp: number;
  state: BossState;
  timer: number;
  hurt: number;
  stink: number;
  spuds: { model: Model; pos: Vector3 }[];
  heldStone: Model;
};

type Projectile = { model: Model; pos: Vector3; vel: Vector3; deflected: boolean; age: number };
type Pickup = { id: number; model: Model; pos: Vector3; phase: number };

const tmp = new Vector3();
const eyeTmp = new Vector3();
const headTmp = new Vector3();
const lightOut: [number, number, number] = [0, 0, 0];

function toLinear(v: number): number {
  return Math.pow(Math.min(v, 1.1), 2.2);
}

function angleTo(from: Vector3, to: Vector3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Game {
  readonly level: Level;
  readonly world: World;
  readonly player: Player;
  hearts = MAX_HEARTS;
  checkpoint = 0;
  over = false;

  private zombies: Zombie[] = [];
  private boss!: Boss;
  private projectiles: Projectile[] = [];
  private pickups: Pickup[] = [];
  private heartsTaken = new Set<number>();
  private nextDropId = 1000;

  private invulnerable = 0;
  private attackCooldown = 0;
  private swing = 0;
  private shieldRaise = 0;
  private blocking = false;
  private walkPhase = 0;
  private wonTimer = -1;

  private readonly sword: Model;
  private readonly shield: Model;

  constructor(private readonly gs: GameScene, private readonly events: GameEvents) {
    this.level = buildLevel1();
    this.world = this.level.world;
    this.player = new Player(this.world);
    gs.setWorld(this.world);

    this.sword = makeSword();
    this.shield = makeShield();
    gs.camera.add(this.sword.group, this.shield.group);

    this.level.zombies.forEach((p, id) => {
      const model = makeZombie();
      const home = new Vector3(p.x, this.groundAt(p.x, 28, p.z), p.z);
      gs.scene.add(model.group);
      this.zombies.push({ id, model, home, pos: home.clone(), yaw: 0, hp: ZOMBIE_HP, state: "idle", timer: 0, hurt: 0, knock: new Vector3(), walk: 0, groan: Math.random() * 4 });
    });

    const b = this.level.boss;
    const bossModel = makePotatoBoss();
    const home = new Vector3(b.x, this.groundAt(b.x, 28, b.z), b.z);
    gs.scene.add(bossModel.group);
    const spuds = [0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      const pos = new Vector3(home.x + Math.cos(a) * 3.6, 0, home.z + Math.sin(a) * 3.2);
      pos.y = this.groundAt(pos.x, home.y + 2, pos.z);
      const model = makeRottenSpud();
      model.group.position.copy(pos);
      model.group.rotation.y = a * 3;
      gs.scene.add(model.group);
      return { model, pos };
    });
    // The stone she lifts over her head before each throw, so players see it coming.
    const heldStone = makeStone();
    heldStone.group.position.set(0, 5.4, 0.3);
    heldStone.group.scale.setScalar(1.3);
    heldStone.group.visible = false;
    bossModel.body.add(heldStone.group);
    this.boss = { model: bossModel, home, pos: home.clone(), yaw: 0, hp: BOSS_MAX_HP, state: "sleep", timer: 0, hurt: 0, stink: 0, spuds, heldStone };
  }

  /** Starts fresh, or resumes from a save. */
  start(save: SaveData | null): void {
    this.over = false;
    this.wonTimer = -1;
    this.checkpoint = save ? Math.min(save.checkpoint, this.level.checkpoints.length - 1) : 0;
    this.hearts = save ? Math.max(1, Math.min(MAX_HEARTS, save.hearts)) : MAX_HEARTS;
    const defeated = new Set(save?.defeatedZombies ?? []);
    this.heartsTaken = new Set(save?.heartsTaken ?? []);

    for (const z of this.zombies) {
      this.resetZombie(z);
      if (defeated.has(z.id)) {
        z.state = "dead";
        z.model.group.visible = false;
      }
    }
    this.resetBoss();
    this.clearProjectiles();
    for (const p of this.pickups) this.gs.scene.remove(p.model.group);
    this.pickups = [];
    this.level.hearts.forEach((h, id) => {
      if (!this.heartsTaken.has(id)) this.spawnPickup(id, new Vector3(h.x, this.groundAt(h.x, 28, h.z), h.z));
    });
    this.placePlayerAtCheckpoint();
    this.events.health(this.hearts);
    this.events.boss(null, BOSS_MAX_HP);
  }

  /** After being defeated: back to the last checkpoint with full hearts. */
  respawn(): void {
    this.over = false;
    this.hearts = MAX_HEARTS;
    for (const z of this.zombies) if (z.state !== "dead") this.resetZombie(z);
    if (this.boss.state !== "dead") this.resetBoss();
    this.clearProjectiles();
    this.placePlayerAtCheckpoint();
    this.invulnerable = 1.5;
    this.events.health(this.hearts);
    this.events.boss(null, BOSS_MAX_HP);
  }

  saveData(): SaveData {
    return {
      level: 1,
      checkpoint: this.checkpoint,
      hearts: this.hearts,
      defeatedZombies: this.zombies.filter((z) => z.state === "dead" || z.state === "dying").map((z) => z.id),
      heartsTaken: [...this.heartsTaken],
    };
  }

  private placePlayerAtCheckpoint(): void {
    const c = this.level.checkpoints[this.checkpoint]!;
    this.player.spawnAt(c.x, c.z, 0);
  }

  private resetZombie(z: Zombie): void {
    z.pos.copy(z.home);
    z.hp = ZOMBIE_HP;
    z.state = "idle";
    z.timer = 0;
    z.hurt = 0;
    z.knock.set(0, 0, 0);
    z.model.group.visible = true;
    z.model.group.rotation.set(0, 0, 0);
  }

  private resetBoss(): void {
    const b = this.boss;
    b.pos.copy(b.home);
    b.hp = BOSS_MAX_HP;
    b.state = "sleep";
    b.timer = 0;
    b.hurt = 0;
    b.model.group.visible = true;
    b.model.group.scale.setScalar(1);
  }

  private clearProjectiles(): void {
    for (const p of this.projectiles) this.gs.scene.remove(p.model.group);
    this.projectiles = [];
  }

  private spawnPickup(id: number, pos: Vector3): void {
    const model = makeHeart();
    model.group.position.copy(pos);
    this.gs.scene.add(model.group);
    this.pickups.push({ id, model, pos: pos.clone(), phase: Math.random() * 6 });
  }

  /** Top of the ground under (x, z), searching down from just above y. Fences and lanterns don't count. */
  private groundAt(x: number, y: number, z: number): number {
    const fx = Math.floor(x);
    const fz = Math.floor(z);
    for (let yy = Math.min(this.world.height - 1, Math.floor(y + 1.3)); yy >= 0; yy--) {
      const def = BLOCKS[this.world.get(fx, yy, fz)]!;
      if (def.solid && def.shape === "cube") return yy + 1;
    }
    return 1;
  }

  /** True if nothing solid (or a tree) blocks the straight line between two points. */
  private canSee(from: Vector3, to: Vector3): boolean {
    const steps = Math.ceil(from.distanceTo(to) / 0.3);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const id = this.world.get(
        Math.floor(from.x + (to.x - from.x) * t),
        Math.floor(from.y + (to.y - from.y) * t),
        Math.floor(from.z + (to.z - from.z) * t),
      );
      if (isOpaque(id) || id === B.PINE) return false;
    }
    return true;
  }

  private playerEye(): Vector3 {
    return eyeTmp.set(this.player.pos.x, this.player.pos.y + EYE_HEIGHT, this.player.pos.z);
  }

  private facing(target: Vector3): number {
    const p = this.player.pos;
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    return (-Math.sin(this.player.yaw) * dx - Math.cos(this.player.yaw) * dz) / d;
  }

  private flatDistance(a: Vector3, b: Vector3): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  // ---------- Combat ----------

  attack(): void {
    if (this.over || this.attackCooldown > 0 || this.blocking) return;
    this.attackCooldown = ATTACK_COOLDOWN;
    this.swing = SWING_TIME;
    sfx.swing();
    let hitSomething = false;

    for (const z of this.zombies) {
      if (z.state === "dying" || z.state === "dead") continue;
      const d = this.flatDistance(z.pos, this.player.pos);
      if (d > SWORD_REACH || (d > 1.1 && this.facing(z.pos) < 0.45)) continue;
      hitSomething = true;
      z.hp--;
      z.hurt = 0.22;
      tmp.set(z.pos.x - this.player.pos.x, 0, z.pos.z - this.player.pos.z).normalize();
      z.knock.copy(tmp).multiplyScalar(4);
      this.gs.burst(tmp.copy(z.pos).setY(z.pos.y + 1.3), [190, 70, 230], { count: 10, speed: 4 });
      if (z.hp <= 0) {
        z.state = "dying";
        z.timer = 0.55;
        sfx.zombieDie();
      } else if (z.state === "windup") {
        z.state = "recover";
        z.timer = 0.6;
      }
    }

    const b = this.boss;
    if (b.state === "idle" || b.state === "windup") {
      const d = this.flatDistance(b.pos, this.player.pos) - BOSS_RADIUS;
      if (d < SWORD_REACH - 0.3 && this.facing(b.pos) > 0.3) {
        hitSomething = true;
        b.hp--;
        b.hurt = 0.25;
        sfx.bossHurt();
        this.gs.burst(tmp.copy(this.player.pos).lerp(b.pos, 0.6).setY(b.pos.y + 1.8), [206, 170, 108], { count: 14, speed: 5 });
        this.events.boss(b.hp, BOSS_MAX_HP);
        if (b.hp <= 0) {
          b.state = "dying";
          b.timer = 1.6;
          sfx.roar();
          this.clearProjectiles();
        }
      }
    }
    if (hitSomething) sfx.hit();
  }

  /** Damages the player unless they're blocking towards the attacker. Returns true if blocked. */
  private hurtPlayer(from: Vector3): boolean {
    if (this.over || this.invulnerable > 0) return false;
    if (this.blocking && this.facing(from) > 0.25) {
      sfx.block();
      this.gs.burst(tmp.copy(this.player.pos).lerp(from, 0.25).setY(this.player.pos.y + 1.2), [255, 236, 170], { count: 8, speed: 5, size: 0.08, gravity: 6 });
      return true;
    }
    this.hearts--;
    this.invulnerable = 1;
    this.player.knockFrom(from.x, from.z, 7);
    sfx.hurt();
    this.events.hurt();
    this.events.health(this.hearts);
    if (this.hearts <= 0) {
      this.over = true;
      sfx.defeat();
      this.events.died();
    }
    return false;
  }

  // ---------- Update ----------

  update(dt: number, input: FrameInput): void {
    this.blocking = input.blocking && !this.over;
    if (!this.over) this.player.update(dt, { ...input.move, slow: this.blocking });
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.swing = Math.max(0, this.swing - dt);

    this.updateCheckpoints();
    for (const z of this.zombies) this.updateZombie(z, dt);
    this.updateBoss(dt);
    this.updateProjectiles(dt);
    this.updatePickups(dt);
    this.updateViewModel(dt, input.move);

    if (this.wonTimer > 0) {
      this.wonTimer -= dt;
      if (this.wonTimer <= 0) {
        this.over = true;
        this.events.won();
      }
    }
  }

  private updateCheckpoints(): void {
    const next = this.level.checkpoints[this.checkpoint + 1];
    if (next && this.player.pos.z < next.triggerZ) {
      this.checkpoint++;
      sfx.checkpoint();
      this.events.toast("✨ Checkpoint! ✨");
      this.events.checkpoint();
    }
  }

  private tint(model: Model, pos: Vector3, flash: number): void {
    this.world.lightAt(Math.floor(pos.x), Math.floor(pos.y + 1), Math.floor(pos.z), lightOut);
    const r = toLinear(CHAR_AMBIENT[0] + lightOut[0]);
    const g = toLinear(CHAR_AMBIENT[1] + lightOut[1]);
    const b = toLinear(CHAR_AMBIENT[2] + lightOut[2]);
    for (const m of model.lit) {
      const base = m.userData["base"] as Color;
      if (flash > 0) m.color.setRGB(2.4 * base.r, 0.5 * base.g, 0.5 * base.b);
      else m.color.setRGB(r * base.r, g * base.g, b * base.b);
    }
  }

  private updateZombie(z: Zombie, dt: number): void {
    if (z.state === "dead") return;
    const m = z.model;
    const p = this.player.pos;
    const dist = this.flatDistance(z.pos, p);
    z.hurt = Math.max(0, z.hurt - dt);
    z.timer -= dt;

    if (z.state === "dying") {
      m.group.rotation.x = Math.min(Math.PI / 2, m.group.rotation.x + dt * 5);
      m.group.position.copy(z.pos);
      if (z.timer <= 0) {
        z.state = "dead";
        m.group.visible = false;
        this.gs.burst(tmp.copy(z.pos).setY(z.pos.y + 0.6), [170, 60, 230], { count: 26, speed: 5, up: 4, size: 0.18 });
        if (Math.random() < 0.5) this.spawnPickup(this.nextDropId++, z.pos.clone());
      }
      this.tint(m, z.pos, 0);
      return;
    }

    // Zombies only come for you when they can see you, and only attack
    // when they're at your level, in clear view and on screen in front of you.
    const dy = Math.abs(z.pos.y - p.y);
    const sees = dy < 2.5 && dist < 22 && this.canSee(headTmp.set(z.pos.x, z.pos.y + 1.8, z.pos.z), this.playerEye());
    const onScreen = this.facing(z.pos) > 0.55;
    let speed = 0;
    let moveYaw = z.yaw;
    if (!this.over) {
      if (z.state === "idle" && dist < 14 && sees) {
        z.state = "chase";
        sfx.groan();
      } else if (z.state === "chase") {
        if (!sees && dist > 4) z.state = "idle";
        else if (dist < 1.8 && dy < 1.2 && sees && onScreen) {
          z.state = "windup";
          z.timer = 0.7;
        } else if (dist < 2.8 && !onScreen) {
          // Walk round to the front of the player so they can see it coming:
          // via their side if it's behind them, so it doesn't walk through them.
          const yaw = this.player.yaw;
          const rx = Math.cos(yaw);
          const rz = -Math.sin(yaw);
          const side = (z.pos.x - p.x) * rx + (z.pos.z - p.z) * rz >= 0 ? 1 : -1;
          const behind = this.facing(z.pos) < 0.1;
          const fx = p.x - Math.sin(yaw) * (behind ? 0.4 : 1.7) + (behind ? rx * side * 1.9 : 0);
          const fz = p.z - Math.cos(yaw) * (behind ? 0.4 : 1.7) + (behind ? rz * side * 1.9 : 0);
          moveYaw = Math.atan2(fx - z.pos.x, fz - z.pos.z);
          speed = Math.hypot(fx - z.pos.x, fz - z.pos.z) > 0.3 ? 2.6 : 0;
        } else if (dist > 1.6) {
          moveYaw = angleTo(z.pos, p);
          speed = 2.3;
        }
      } else if (z.state === "windup" && z.timer <= 0) {
        if (dist < 2.4 && dy < 1.5) {
          const blocked = this.hurtPlayer(z.pos);
          if (blocked) z.knock.set(z.pos.x - p.x, 0, z.pos.z - p.z).normalize().multiplyScalar(5);
        }
        z.state = "recover";
        z.timer = 0.9;
      } else if (z.state === "recover" && z.timer <= 0) {
        z.state = "chase";
      }
    } else if (z.state !== "idle") {
      z.state = "idle";
    }

    if (z.state !== "idle") z.yaw = lerpAngle(z.yaw, angleTo(z.pos, p), Math.min(1, dt * 8));
    z.groan -= dt;
    if (z.groan <= 0 && z.state === "chase") {
      z.groan = 3 + Math.random() * 4;
      if (dist < 12) sfx.groan();
    }

    // Movement: walking plus any knockback, following the ground.
    let mx = Math.sin(moveYaw) * speed * dt + z.knock.x * dt;
    let mz = Math.cos(moveYaw) * speed * dt + z.knock.z * dt;
    z.knock.multiplyScalar(Math.max(0, 1 - dt * 6));
    for (const o of this.zombies) {
      if (o === z || o.state === "dead" || o.state === "dying") continue;
      const dx = z.pos.x - o.pos.x;
      const dz = z.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 0.9) {
        mx += (dx / d) * (0.9 - d) * 0.5;
        mz += (dz / d) * (0.9 - d) * 0.5;
      }
    }
    if (dist < 0.95 && dist > 0.01) {
      mx += ((z.pos.x - p.x) / dist) * (0.95 - dist);
      mz += ((z.pos.z - p.z) / dist) * (0.95 - dist);
    }
    this.moveOnGround(z.pos, mx, mz, dt);

    // Animation.
    if (speed > 0) z.walk += dt * 7;
    const swingAmt = speed > 0 ? Math.sin(z.walk) * 0.55 : 0;
    m.leftLeg.rotation.x = swingAmt;
    m.rightLeg.rotation.x = -swingAmt;
    let arm = -1.35 + Math.sin(z.walk * 0.5) * 0.08;
    if (z.state === "windup") arm = -1.35 - 1.3 * Math.min(1, (0.7 - z.timer) / 0.5);
    else if (z.state === "recover" && z.timer > 0.7) arm = -0.6;
    m.leftArm.rotation.x = arm;
    m.rightArm.rotation.x = arm;
    m.body.rotation.z = Math.sin(z.walk * 0.5) * 0.06;
    m.group.position.copy(z.pos);
    m.group.rotation.y = z.yaw;
    const glow = z.state === "windup" ? 1.8 : 1;
    for (const g of m.glow) g.color.setRGB(3.2 * glow, 0.9 * glow, 5 * glow);
    this.tint(m, z.pos, z.hurt);
  }

  private moveOnGround(pos: Vector3, mx: number, mz: number, dt: number): void {
    const gx = this.groundAt(pos.x + mx, pos.y, pos.z);
    if (gx - pos.y < 1.3 && !this.world.isSolid(Math.floor(pos.x + mx), Math.floor(gx + 1), Math.floor(pos.z))) pos.x += mx;
    const gz = this.groundAt(pos.x, pos.y, pos.z + mz);
    if (gz - pos.y < 1.3 && !this.world.isSolid(Math.floor(pos.x), Math.floor(gz + 1), Math.floor(pos.z + mz))) pos.z += mz;
    const g = this.groundAt(pos.x, pos.y, pos.z);
    if (pos.y > g) pos.y = Math.max(g, pos.y - 10 * dt);
    else pos.y += (g - pos.y) * Math.min(1, dt * 14);
  }

  private updateBoss(dt: number): void {
    const b = this.boss;
    const m = b.model;
    const p = this.player.pos;
    if (b.state === "dead") return;
    b.hurt = Math.max(0, b.hurt - dt);
    b.timer -= dt;
    const dist = this.flatDistance(b.pos, p);

    // Stink clouds rising from the boss and her little rotten potatoes.
    b.stink -= dt;
    if (b.stink <= 0) {
      b.stink = 0.09;
      const src = Math.random() < 0.4 ? tmp.copy(b.pos).setY(b.pos.y + 4.6) : tmp.copy(b.spuds[Math.floor(Math.random() * b.spuds.length)]!.pos).setY(b.pos.y + 0.6);
      this.gs.burst(src, [190, 214, 70], { count: 1, speed: 0.6, up: 1.4, gravity: -0.6, life: 1.8, size: 0.22, spread: 0.5 });
    }

    if (b.state === "dying") {
      const t = Math.max(0, b.timer / 1.6);
      m.group.scale.set(1 + (1 - t) * 0.25, t, 1 + (1 - t) * 0.25);
      if (Math.random() < 0.5) this.gs.burst(tmp.copy(b.pos).setY(b.pos.y + 2 * t + 0.5), [206, 170, 108], { count: 3, speed: 7, up: 5, size: 0.24 });
      if (b.timer <= 0) {
        b.state = "dead";
        m.group.visible = false;
        this.gs.burst(tmp.copy(b.pos).setY(b.pos.y + 1), [200, 220, 80], { count: 60, speed: 9, up: 6, size: 0.25 });
        this.events.boss(null, BOSS_MAX_HP);
        sfx.victory();
        this.wonTimer = 1.8;
      }
      this.tint(m, b.pos, 0);
      return;
    }

    // She only wakes once you're inside her arena, and only throws while she can see you.
    const arena = this.level.arena;
    const inArena = Math.hypot(p.x - arena.x, p.z - arena.z) < arena.r + 1;
    const sees = this.canSee(headTmp.set(b.pos.x, b.pos.y + 3.4, b.pos.z), this.playerEye());
    if (!this.over) {
      if (b.state === "sleep" && inArena && sees) {
        b.state = "idle";
        b.timer = 2.8;
        sfx.roar();
        this.events.bossIntro();
        this.events.boss(b.hp, BOSS_MAX_HP);
      } else if (b.state === "idle" && b.timer <= 0) {
        if (inArena && sees) {
          b.state = "windup";
          b.timer = 0.9;
        } else {
          b.timer = 0.5;
        }
      } else if (b.state === "windup" && b.timer <= 0) {
        this.throwStone();
        b.state = "idle";
        b.timer = b.hp <= 5 ? 1.9 : 2.6;
      }
    }
    b.heldStone.group.visible = b.state === "windup";
    if (b.state === "windup") this.tint(b.heldStone, b.pos, 0);

    if (b.state !== "sleep") b.yaw = lerpAngle(b.yaw, angleTo(b.pos, p), Math.min(1, dt * 2.5));

    // Keep the player from walking inside her.
    if (dist < BOSS_RADIUS + 0.4 && dist > 0.01) {
      const push = BOSS_RADIUS + 0.4 - dist;
      p.x += ((p.x - b.pos.x) / dist) * push;
      p.z += ((p.z - b.pos.z) / dist) * push;
    }

    const breathe = Math.sin(performance.now() / 400) * 0.03;
    m.body.scale.set(1 - breathe, 1 + breathe, 1 - breathe);
    m.body.rotation.x = b.state === "windup" ? -0.2 * Math.min(1, (0.9 - b.timer) / 0.6) : Math.max(0, m.body.rotation.x - dt * 2);
    m.group.position.copy(b.pos);
    m.group.rotation.y = b.yaw;
    this.tint(m, b.pos, b.hurt);
    for (const s of b.spuds) this.tint(s.model, s.pos, 0);
  }

  private throwStone(): void {
    const b = this.boss;
    const start = new Vector3(b.pos.x + Math.sin(b.yaw) * 1.2, b.pos.y + 5.2, b.pos.z + Math.cos(b.yaw) * 1.2);
    const target = new Vector3(this.player.pos.x, this.player.pos.y + 1.1, this.player.pos.z);
    const T = Math.min(1.8, Math.max(1, start.distanceTo(target) / 8));
    const g = 14;
    const vel = new Vector3((target.x - start.x) / T, (target.y - start.y) / T + 0.5 * g * T, (target.z - start.z) / T);
    const model = makeStone();
    model.group.position.copy(start);
    this.gs.scene.add(model.group);
    this.projectiles.push({ model, pos: start, vel, deflected: false, age: 0 });
    b.model.body.rotation.x = 0.25;
    sfx.throw();
  }

  private updateProjectiles(dt: number): void {
    const chest = tmp.set(this.player.pos.x, this.player.pos.y + 1.1, this.player.pos.z);
    const chestPos = chest.clone();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i]!;
      pr.age += dt;
      pr.vel.y -= 14 * dt;
      pr.pos.addScaledVector(pr.vel, dt);
      pr.model.group.position.copy(pr.pos);
      pr.model.group.rotation.x += dt * 5;
      pr.model.group.rotation.z += dt * 3;
      this.tint(pr.model, pr.pos, 0);
      if (Math.random() < 0.3) this.gs.burst(pr.pos, [140, 138, 146], { count: 1, speed: 0.4, up: 0.2, gravity: 2, life: 0.4, size: 0.1 });

      let remove = false;
      if (!pr.deflected && pr.pos.distanceTo(chestPos) < 1) {
        if (this.hurtPlayer(pr.pos)) {
          pr.deflected = true;
          pr.vel.set(-pr.vel.x * 0.35, 4, -pr.vel.z * 0.35);
        } else {
          remove = true;
        }
      }
      if (this.world.isSolid(Math.floor(pr.pos.x), Math.floor(pr.pos.y), Math.floor(pr.pos.z)) || pr.age > 5) remove = true;
      if (remove) {
        sfx.splat();
        this.gs.burst(pr.pos, [150, 148, 156], { count: 16, speed: 5, up: 4, size: 0.18 });
        this.gs.scene.remove(pr.model.group);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private updatePickups(dt: number): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const h = this.pickups[i]!;
      h.phase += dt;
      h.model.group.position.set(h.pos.x, h.pos.y + 0.5 + Math.sin(h.phase * 3) * 0.12, h.pos.z);
      h.model.group.rotation.y = h.phase * 2;
      const d = h.model.group.position.distanceTo(tmp.set(this.player.pos.x, this.player.pos.y + 0.6, this.player.pos.z));
      if (d < 1.3 && this.hearts < MAX_HEARTS && !this.over) {
        this.hearts++;
        sfx.pickup();
        this.events.health(this.hearts);
        this.gs.burst(h.model.group.position, [255, 90, 110], { count: 14, speed: 3, up: 3, size: 0.1 });
        this.gs.scene.remove(h.model.group);
        if (h.id < 1000) this.heartsTaken.add(h.id);
        this.pickups.splice(i, 1);
      }
    }
  }

  private updateViewModel(dt: number, move: MoveInput): void {
    const moving = Math.abs(move.forward) + Math.abs(move.right) > 0 && this.player.onGround;
    if (moving) this.walkPhase += dt * 9;
    const bob = moving ? Math.sin(this.walkPhase) * 0.018 : 0;
    const sway = moving ? Math.cos(this.walkPhase * 0.5) * 0.015 : 0;

    const s = this.swing > 0 ? Math.sin((1 - this.swing / SWING_TIME) * Math.PI) : 0;
    const sw = this.sword.group;
    sw.position.set(0.4 - 0.32 * s + sway, -0.4 + bob + 0.08 * s, -0.72);
    sw.rotation.set(-0.55 - 1.0 * s, -0.15, -0.3 + 1.25 * s);

    this.shieldRaise += ((this.blocking ? 1 : 0) - this.shieldRaise) * Math.min(1, dt * 14);
    const r = this.shieldRaise;
    const sh = this.shield.group;
    sh.position.set(-0.46 + 0.34 * r - sway, -0.44 + 0.24 * r + bob, -0.68 + 0.16 * r);
    sh.rotation.set(0, 0.55 * (1 - r), 0.05);

    const eye = this.player.eye(tmp);
    eye.y -= EYE_HEIGHT;
    this.tint(this.sword, eye, 0);
    this.tint(this.shield, eye, 0);
    // Flicker while invulnerable after a hit.
    const visible = this.invulnerable <= 0 || Math.floor(this.invulnerable * 12) % 2 === 0;
    sw.visible = sh.visible = visible || this.over;
  }
}

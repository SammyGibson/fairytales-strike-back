import { type Color, Vector3 } from "three";
import { B, BLOCKS, isOpaque } from "./blocks";
import type { Boss, BossContext, BossIntro, ProjectileSpec } from "./bosses/boss";
import { BloodBoxBoss } from "./bosses/bloodbox";
import { FireRoseBoss } from "./bosses/firerose";
import { PotatoBoss } from "./bosses/potato";
import { SamBoss } from "./bosses/sam";
import { buildLevel, type BossSpawn, type Level, type Reward } from "./levels";
import { makeFlameSword, makeGiantDoor, makeHeart, makeShield, makeSword, makeZombie, type DoorModel, type Model, type ZombieModel } from "./models";
import { EYE_HEIGHT, Player, type MoveInput } from "./player";
import type { SaveData } from "./save";
import type { GameScene } from "./scene";
import { sfx } from "./sound";
import type { World } from "./world";

export const MAX_HEARTS = 6;
const ZOMBIE_HP = 2;
const SWORD_REACH = 2.7;
const ATTACK_COOLDOWN = 0.38;
const SWING_TIME = 0.3;
/** Moonlight on characters, in sRGB terms (a touch brighter than the terrain so enemies read well). */
const CHAR_AMBIENT = [0.46, 0.5, 0.74] as const;

export type GameEvents = {
  health(hearts: number): void;
  boss(hp: number | null, max: number, name: string): void;
  bossIntro(intro: BossIntro): void;
  /** The player picked up a reward item. */
  reward(reward: Reward): void;
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

type Projectile = ProjectileSpec & { deflected: boolean; age: number };
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
  private boss: Boss;
  /** How many bosses in this level's line-up have been beaten. */
  private bossIndex = 0;
  private readonly bossCtx: BossContext;
  private readonly door: DoorModel | null = null;
  private doorOpen = 0;
  private doorTarget = 0;
  /** Counts down to the next boss coming through the door (-1 when idle). */
  private nextBossTimer = -1;
  private readonly hintsShown = new Set<string>();
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
  private readonly flameSword: Model;
  private readonly shield: Model;
  /** Whether the Flaming Sword is in hand (once unlocked). */
  private flameEquipped = false;
  private emberTimer = 0;
  private rewardPickup: { model: Model; pos: Vector3; reward: Reward; phase: number } | null = null;

  constructor(private readonly gs: GameScene, private readonly events: GameEvents, levelId: number) {
    this.level = buildLevel(levelId);
    this.world = this.level.world;
    this.player = new Player(this.world);
    gs.setWorld(this.world);

    this.sword = makeSword();
    this.flameSword = makeFlameSword(true);
    this.flameSword.group.visible = false;
    this.shield = makeShield();
    gs.camera.add(this.sword.group, this.flameSword.group, this.shield.group);

    this.level.zombies.forEach((p, id) => {
      const model = makeZombie();
      const home = new Vector3(p.x, this.groundAt(p.x, 28, p.z), p.z);
      gs.scene.add(model.group);
      this.zombies.push({ id, model, home, pos: home.clone(), yaw: 0, hp: ZOMBIE_HP, state: "idle", timer: 0, hurt: 0, knock: new Vector3(), walk: 0, groan: Math.random() * 4 });
    });

    const ctx: BossContext = {
      arena: this.level.arena,
      gs,
      player: this.player,
      playerEye: () => this.playerEye(),
      canSee: (from, to) => this.canSee(from, to),
      inArena: () => {
        const a = this.level.arena;
        const p = this.player.pos;
        return Math.hypot((p.x - a.x) / a.rx, (p.z - a.z) / a.rz) < 1;
      },
      isOver: () => this.over,
      groundAt: (x, y, z) => this.groundAt(x, y, z),
      tint: (model, pos, flash) => this.tint(model, pos, flash),
      launch: (spec) => {
        spec.model.group.position.copy(spec.pos);
        gs.scene.add(spec.model.group);
        this.projectiles.push({ ...spec, deflected: false, age: 0 });
      },
      clearProjectiles: () => this.clearProjectiles(),
      hurtPlayer: (from, blockable) => this.hurtPlayer(from, blockable),
      facing: (target) => this.facing(target),
      hint: (key, message) => {
        if (this.hintsShown.has(key)) return;
        this.hintsShown.add(key);
        events.toast(message);
      },
      awoke: (intro) => {
        events.bossIntro(intro);
        events.boss(this.boss.hp, this.boss.maxHp, this.boss.name);
      },
      healthChanged: () => events.boss(this.boss.hp, this.boss.maxHp, this.boss.name),
      defeated: () => {
        events.boss(null, this.boss.maxHp, this.boss.name);
        sfx.victory();
        this.bossIndex++;
        this.events.checkpoint();
        const spawn = this.level.bosses[this.bossIndex - 1];
        if (this.bossIndex < this.level.bosses.length) this.nextBossTimer = 2.2;
        else if (spawn?.reward) this.dropReward(spawn.reward, this.boss.pos);
        else this.wonTimer = 1.8;
      },
    };
    this.bossCtx = ctx;
    this.boss = this.makeBoss(this.level.bosses[0]!);

    const d = this.level.door;
    if (d) {
      this.door = makeGiantDoor(d.width, d.height);
      this.door.group.position.set(d.x, this.groundAt(d.x, 28, d.z + 1), d.z);
      gs.scene.add(this.door.group);
    }
  }

  private makeBoss(spawn: BossSpawn): Boss {
    const home = new Vector3(spawn.x, this.groundAt(spawn.x, 28, spawn.z), spawn.z);
    switch (spawn.kind) {
      case "sam":
        return new SamBoss(this.bossCtx, home);
      case "bloodbox":
        return new BloodBoxBoss(this.bossCtx, home);
      case "potato":
        return new PotatoBoss(this.bossCtx, home);
      case "firerose":
        return new FireRoseBoss(this.bossCtx, home);
    }
  }

  /** Leaves a reward item floating where the last boss fell; the level ends once it's picked up. */
  private dropReward(reward: Reward, at: Vector3): void {
    const model = makeFlameSword(false);
    model.group.scale.setScalar(2.2);
    const pos = new Vector3(at.x, this.groundAt(at.x, at.y + 1, at.z), at.z);
    model.group.position.copy(pos);
    this.gs.scene.add(model.group);
    this.rewardPickup = { model, pos, reward, phase: 0 };
    this.events.toast("Fire Rose dropped something! Go and grab it!");
  }

  private updateReward(dt: number): void {
    const r = this.rewardPickup;
    if (!r) return;
    r.phase += dt;
    r.model.group.position.set(r.pos.x, r.pos.y + 1 + Math.sin(r.phase * 2.5) * 0.2, r.pos.z);
    r.model.group.rotation.set(0, r.phase * 1.5, 0.3);
    if (Math.random() < dt * 20) this.gs.burst(tmp.copy(r.model.group.position).setY(r.pos.y + 1 + Math.random() * 1.6), [255, 140, 40], { count: 1, speed: 0.6, up: 1.5, gravity: -1, life: 0.8, size: 0.1 });
    if (this.flatDistance(r.pos, this.player.pos) < 1.6 && !this.over) {
      this.gs.scene.remove(r.model.group);
      this.rewardPickup = null;
      sfx.reward();
      this.gs.burst(tmp.copy(r.pos).setY(r.pos.y + 1.2), [255, 180, 60], { count: 40, speed: 6, up: 5, size: 0.16 });
      this.events.reward(r.reward);
      this.wonTimer = 4;
    }
  }

  /** Lets the player use the Flaming Sword (once they've earned it). */
  setFlameSword(equipped: boolean): void {
    this.flameEquipped = equipped;
    this.sword.group.visible = !equipped;
    this.flameSword.group.visible = equipped;
  }

  private swordPower(): number {
    return this.flameEquipped ? 2 : 1;
  }

  /** Switches to boss number `index` in the line-up, waiting at its home spot. */
  private useBoss(index: number): void {
    this.boss.dispose();
    this.bossIndex = index;
    const spawn = this.level.bosses[Math.min(index, this.level.bosses.length - 1)]!;
    this.boss = this.makeBoss(spawn);
    if (index >= this.level.bosses.length) this.boss.state = "dead";
    // The door stays open once a door boss has come out.
    this.doorTarget = this.doorOpen = this.level.bosses.slice(0, index + 1).some((b) => b.fromDoor) ? 1 : 0;
  }

  /** The next boss in the line-up comes out of the giant door. */
  private releaseNextBoss(): void {
    this.useBoss(this.bossIndex);
    this.doorOpen = 0;
    this.doorTarget = 1;
    const inside = this.level.door?.inside;
    if (inside && this.boss.emerge) {
      // Search for the tunnel floor from door height, not from above the roof.
      const floorY = this.groundAt(inside.x, this.door?.group.position.y ?? 28, inside.z);
      this.boss.emerge(new Vector3(inside.x, floorY, inside.z));
    }
    sfx.door();
    this.events.toast("The giant door is opening!");
  }

  /** Removes everything this level added to the scene. */
  dispose(): void {
    for (const z of this.zombies) this.gs.scene.remove(z.model.group);
    for (const p of this.pickups) this.gs.scene.remove(p.model.group);
    this.clearProjectiles();
    this.boss.dispose();
    if (this.door) this.gs.scene.remove(this.door.group);
    if (this.rewardPickup) this.gs.scene.remove(this.rewardPickup.model.group);
    this.gs.camera.remove(this.sword.group, this.flameSword.group, this.shield.group);
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
    this.nextBossTimer = -1;
    if (this.rewardPickup) this.gs.scene.remove(this.rewardPickup.model.group);
    this.rewardPickup = null;
    this.useBoss(Math.min(save?.bossesDefeated ?? 0, this.level.bosses.length));
    this.clearProjectiles();
    for (const p of this.pickups) this.gs.scene.remove(p.model.group);
    this.pickups = [];
    this.level.hearts.forEach((h, id) => {
      if (!this.heartsTaken.has(id)) this.spawnPickup(id, new Vector3(h.x, this.groundAt(h.x, 28, h.z), h.z));
    });
    this.placePlayerAtCheckpoint();
    this.events.health(this.hearts);
    this.events.boss(null, this.boss.maxHp, this.boss.name);
  }

  /** After being defeated: back to the last checkpoint with full hearts. */
  respawn(): void {
    this.over = false;
    this.hearts = MAX_HEARTS;
    for (const z of this.zombies) if (z.state !== "dead") this.resetZombie(z);
    if (this.nextBossTimer >= 0 || (this.boss.state === "dead" && this.bossIndex < this.level.bosses.length)) {
      // Defeated while the next boss was on its way: it waits in the arena instead.
      this.nextBossTimer = -1;
      this.useBoss(this.bossIndex);
    } else if (this.boss.state !== "dead") {
      this.boss.reset();
    }
    this.clearProjectiles();
    this.placePlayerAtCheckpoint();
    this.invulnerable = 1.5;
    this.events.health(this.hearts);
    this.events.boss(null, this.boss.maxHp, this.boss.name);
  }

  saveData(): SaveData {
    return {
      level: this.level.id,
      checkpoint: this.checkpoint,
      hearts: this.hearts,
      defeatedZombies: this.zombies.filter((z) => z.state === "dead" || z.state === "dying").map((z) => z.id),
      heartsTaken: [...this.heartsTaken],
      bossesDefeated: this.bossIndex,
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
      z.hp -= this.swordPower();
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

    const reaches = (pos: Vector3, radius: number) => {
      const d = this.flatDistance(pos, this.player.pos) - radius;
      return d < SWORD_REACH - 0.3 && (d < 0.8 || this.facing(pos) > 0.3) && Math.abs(pos.y - this.player.pos.y) < 3;
    };
    if (this.boss.swordHit(reaches, this.swordPower())) hitSomething = true;
    if (hitSomething) sfx.hit();
    if (hitSomething && this.flameEquipped) {
      // A burst of flame in front of the player.
      tmp.set(this.player.pos.x - Math.sin(this.player.yaw) * 1.8, this.player.pos.y + 1.2, this.player.pos.z - Math.cos(this.player.yaw) * 1.8);
      this.gs.burst(tmp, [255, 140, 40], { count: 16, speed: 4, up: 3, gravity: -1, size: 0.14 });
    }
  }

  /** Damages the player unless they're blocking towards the attacker. Returns true if blocked. */
  private hurtPlayer(from: Vector3, blockable = true): boolean {
    if (this.over || this.invulnerable > 0) return false;
    if (blockable && this.blocking && this.facing(from) > 0.25) {
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
    this.updateDoor(dt);
    this.updateReward(dt);
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

  private updateDoor(dt: number): void {
    if (this.nextBossTimer >= 0) {
      this.nextBossTimer -= dt;
      if (this.nextBossTimer < 0) this.releaseNextBoss();
    }
    if (!this.door) return;
    this.doorOpen += Math.sign(this.doorTarget - this.doorOpen) * Math.min(Math.abs(this.doorTarget - this.doorOpen), dt * 0.6);
    // A closed door blocks the way into the tunnel behind it.
    const d = this.level.door!;
    const p = this.player.pos;
    if (this.doorOpen < 0.9 && Math.abs(p.x - d.x) < d.width / 2 + 0.3 && p.z < d.z + 0.6 && p.z > d.z - 3) p.z = d.z + 0.6;
    const angle = this.doorOpen * 1.75;
    this.door.left.rotation.y = angle;
    this.door.right.rotation.y = -angle;
    this.tint(this.door, this.door.group.position, 0);
  }

  private updateBoss(dt: number): void {
    const b = this.boss;
    b.update(dt);
    if (b.state === "dead") return;
    // Keep the player from walking inside the boss.
    const p = this.player.pos;
    const dist = this.flatDistance(b.pos, p);
    // A bit of extra space so a big boss never fills the whole screen; the sword still reaches.
    const keepOut = b.radius + 1.1;
    if (dist < keepOut && dist > 0.01) {
      const push = keepOut - dist;
      p.x += ((p.x - b.pos.x) / dist) * push;
      p.z += ((p.z - b.pos.z) / dist) * push;
    }
  }

  private updateProjectiles(dt: number): void {
    const chest = tmp.set(this.player.pos.x, this.player.pos.y + 1.1, this.player.pos.z);
    const chestPos = chest.clone();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i]!;
      pr.age += dt;
      pr.vel.y -= pr.gravity * dt;
      pr.pos.addScaledVector(pr.vel, dt);
      pr.model.group.position.copy(pr.pos);
      pr.model.group.rotation.x += dt * pr.spin;
      pr.model.group.rotation.z += dt * pr.spin * 0.6;
      this.tint(pr.model, pr.pos, 0);
      if (Math.random() < 0.5) this.gs.burst(pr.pos, pr.trail, { count: 1, speed: 0.4, up: 0.2, gravity: pr.gravity > 0 ? 2 : -2, life: 0.4, size: 0.1 });

      let remove = false;
      if (!pr.deflected && pr.pos.distanceTo(chestPos) < pr.radius) {
        if (this.hurtPlayer(pr.pos)) {
          // Blocked: it bounces off the shield and drops.
          pr.deflected = true;
          pr.gravity = Math.max(pr.gravity, 12);
          pr.vel.set(-pr.vel.x * 0.35, 4, -pr.vel.z * 0.35);
        } else {
          remove = true;
        }
      }
      if (this.world.isSolid(Math.floor(pr.pos.x), Math.floor(pr.pos.y), Math.floor(pr.pos.z)) || pr.age > 5) remove = true;
      if (remove) {
        sfx.splat();
        this.gs.burst(pr.pos, pr.splat, { count: 16, speed: 5, up: 4, size: 0.18 });
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
    for (const sw of [this.sword.group, this.flameSword.group]) {
      sw.position.set(0.4 - 0.32 * s + sway, -0.4 + bob + 0.08 * s, -0.72);
      sw.rotation.set(-0.55 - 1.0 * s, -0.15, -0.3 + 1.25 * s);
    }
    // Embers trailing off the Flaming Sword.
    this.emberTimer -= dt;
    if (this.flameEquipped && this.emberTimer <= 0) {
      this.emberTimer = this.swing > 0 ? 0.015 : 0.06;
      const ember = this.gs.camera.localToWorld(tmp.set(0.38 - 0.3 * s + (Math.random() - 0.5) * 0.08, -0.05 + Math.random() * 0.3, -1));
      this.gs.burst(ember, Math.random() < 0.5 ? [255, 140, 40] : [255, 220, 90], { count: 1, speed: 0.15, up: 0.3, gravity: -0.4, life: 0.35, size: 0.018, spread: 0.03 });
    }
    const sw = this.flameEquipped ? this.flameSword.group : this.sword.group;

    this.shieldRaise += ((this.blocking ? 1 : 0) - this.shieldRaise) * Math.min(1, dt * 14);
    const r = this.shieldRaise;
    const sh = this.shield.group;
    sh.position.set(-0.46 + 0.34 * r - sway, -0.44 + 0.24 * r + bob, -0.68 + 0.16 * r);
    sh.rotation.set(0, 0.55 * (1 - r), 0.05);

    const eye = this.player.eye(tmp);
    eye.y -= EYE_HEIGHT;
    this.tint(this.sword, eye, 0);
    this.tint(this.flameSword, eye, 0);
    this.tint(this.shield, eye, 0);
    // Flicker while invulnerable after a hit.
    const visible = this.invulnerable <= 0 || Math.floor(this.invulnerable * 12) % 2 === 0;
    sw.visible = sh.visible = visible || this.over;
    (this.flameEquipped ? this.sword.group : this.flameSword.group).visible = false;
  }
}

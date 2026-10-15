import type { Vector3 } from "three";
import type { Arena } from "../levels";
import type { Model } from "../models";
import type { Player } from "../player";
import type { GameScene } from "../scene";

export type BossState = "sleep" | "entering" | "active" | "dying" | "dead";

export type BossIntro = { title: string; subtitle: string; image: string };

export type ProjectileSpec = {
  model: Model;
  pos: Vector3;
  vel: Vector3;
  /** Downward pull per second; 0 flies straight. */
  gravity: number;
  /** How close to the player's chest counts as a hit. */
  radius: number;
  trail: [number, number, number];
  splat: [number, number, number];
  spin: number;
};

/** What the game offers a boss so it can see, move, attack and report back. */
export type BossContext = {
  gs: GameScene;
  player: Player;
  playerEye(): Vector3;
  canSee(from: Vector3, to: Vector3): boolean;
  arena: Arena;
  inArena(): boolean;
  isOver(): boolean;
  groundAt(x: number, y: number, z: number): number;
  tint(model: Model, pos: Vector3, flash: number): void;
  launch(projectile: ProjectileSpec): void;
  /** Hurts the player; blockable attacks are stopped by a shield facing `from`. Returns true if blocked. */
  hurtPlayer(from: Vector3, blockable: boolean): boolean;
  /** How directly the player faces a point: 1 straight ahead, 0 to the side, -1 behind. */
  facing(target: Vector3): number;
  /** Shows a one-time tip the first time a move is used. */
  hint(key: string, message: string): void;
  clearProjectiles(): void;
  /** Called when the boss wakes, with its intro card. */
  awoke(intro: BossIntro): void;
  healthChanged(): void;
  defeated(): void;
};

export interface Boss {
  readonly name: string;
  readonly maxHp: number;
  hp: number;
  readonly pos: Vector3;
  /** Body radius, for sword reach and keeping the player out. */
  readonly radius: number;
  state: BossState;
  reset(): void;
  update(dt: number): void;
  /**
   * The player swung their sword. `reaches(pos, radius)` says whether a body
   * at pos is in range and in front of them; `power` is the damage per hit.
   * Returns true if anything was hit.
   */
  swordHit(reaches: (pos: Vector3, radius: number) => boolean, power: number): boolean;
  /** Walk out from `from` to the boss's home spot, then wake (used for the giant door). */
  emerge?(from: Vector3): void;
  dispose(): void;
}

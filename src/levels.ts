import { buildLevel1 } from "./level1";
import { buildLevel2 } from "./level2";
import type { World } from "./world";

export type Point = { x: number; z: number };
export type Checkpoint = { x: number; z: number; triggerZ: number };
/** An oval area; the boss wakes once the player is inside it. */
export type Arena = { x: number; z: number; rx: number; rz: number };
export type BossKind = "potato" | "sam" | "bloodbox" | "firerose";
export type Reward = "flameSword";
/** A boss in the level's line-up. `fromDoor` bosses come out of the giant door after the one before is beaten. */
export type BossSpawn = Point & { kind: BossKind; fromDoor?: boolean; reward?: Reward };
/** A giant door in the arena wall; `inside` is where bosses start behind it. */
export type Door = { x: number; z: number; width: number; height: number; inside: Point };

export type Level = {
  id: number;
  name: string;
  world: World;
  checkpoints: Checkpoint[];
  zombies: Point[];
  bosses: BossSpawn[];
  door?: Door;
  arena: Arena;
  hearts: Point[];
};

export const LEVEL_COUNT = 2;

export const LEVEL_NAMES: Record<number, string> = {
  1: "Moonlit Hollow",
  2: "The Colosseum",
};

export function buildLevel(id: number): Level {
  return id === 2 ? buildLevel2() : buildLevel1();
}

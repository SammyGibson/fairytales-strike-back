import { Vector3 } from "three";
import { B } from "./blocks";
import type { World } from "./world";

const WIDTH = 0.6;
const HALF = WIDTH / 2;
export const PLAYER_HEIGHT = 1.75;
export const EYE_HEIGHT = 1.6;

const WALK_SPEED = 4.6;
const SWIM_SPEED = 3;
const GRAVITY = 30;
const JUMP_SPEED = 9;
const MAX_STEP = 0.4;

export type MoveInput = {
  forward: number;
  right: number;
  jump: boolean;
  /** Move at half speed (e.g. while holding the shield up). */
  slow: boolean;
};

export class Player {
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  yaw = 0;
  pitch = 0;
  onGround = false;
  inWater = false;

  constructor(private world: World) {}

  setWorld(world: World): void {
    this.world = world;
  }

  /** Places the player standing on the ground at (x, z). */
  spawnAt(x: number, z: number, yaw = 0): void {
    const y = this.world.surfaceY(Math.floor(x), Math.floor(z));
    this.pos.set(x, y + 1, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
  }

  eye(target: Vector3): Vector3 {
    return target.set(this.pos.x, this.pos.y + EYE_HEIGHT, this.pos.z);
  }

  lookDirection(target: Vector3): Vector3 {
    const cp = Math.cos(this.pitch);
    return target.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp).normalize();
  }

  look(dx: number, dy: number): void {
    this.yaw -= dx;
    this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch - dy));
  }

  /** True if the player's body overlaps the given block cell. */
  overlapsBlock(x: number, y: number, z: number): boolean {
    const p = this.pos;
    return (
      x + 1 > p.x - HALF && x < p.x + HALF &&
      y + 1 > p.y && y < p.y + PLAYER_HEIGHT &&
      z + 1 > p.z - HALF && z < p.z + HALF
    );
  }

  /** Shoves the player away from a point (when hit). */
  knockFrom(x: number, z: number, strength: number): void {
    const dx = this.pos.x - x;
    const dz = this.pos.z - z;
    const d = Math.hypot(dx, dz) || 1;
    this.vel.x += (dx / d) * strength;
    this.vel.z += (dz / d) * strength;
    this.vel.y = Math.max(this.vel.y, 5);
  }

  update(dt: number, input: MoveInput): void {
    const w = this.world;
    this.inWater = w.get(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.4), Math.floor(this.pos.z)) === B.WATER;

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let mx = -sin * input.forward + cos * input.right;
    let mz = -cos * input.forward - sin * input.right;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const speed = (this.inWater ? SWIM_SPEED : WALK_SPEED) * (input.slow ? 0.5 : 1);
    // Less air control, so a knockback shove carries the player.
    const blend = Math.min(1, dt * (this.onGround || this.inWater ? 12 : 3));
    this.vel.x += (mx * speed - this.vel.x) * blend;
    this.vel.z += (mz * speed - this.vel.z) * blend;

    if (this.inWater) {
      this.vel.y = input.jump ? 4 : Math.max(this.vel.y - 10 * dt, -3);
    } else {
      this.vel.y = Math.max(this.vel.y - GRAVITY * dt, -40);
      if (input.jump && this.onGround) this.vel.y = JUMP_SPEED;
    }

    this.onGround = false;
    const hitX = this.moveAxis(0, this.vel.x * dt);
    const hitZ = this.moveAxis(2, this.vel.z * dt);
    this.moveAxis(1, this.vel.y * dt);

    // Auto-jump onto one-block steps so young players don't get stuck.
    if ((hitX || hitZ) && len > 0.1 && (this.onGround || this.inWater)) {
      const ahead = new Vector3(this.pos.x + Math.sign(mx) * 0.5 * (hitX ? 1 : 0), this.pos.y + 1.05, this.pos.z + Math.sign(mz) * 0.5 * (hitZ ? 1 : 0));
      if (!this.collidesAt(ahead.x, ahead.y, ahead.z)) this.vel.y = JUMP_SPEED;
    }

  }

  private collidesAt(px: number, py: number, pz: number): boolean {
    const w = this.world;
    const x0 = Math.floor(px - HALF);
    const x1 = Math.floor(px + HALF);
    const y0 = Math.floor(py);
    const y1 = Math.floor(py + PLAYER_HEIGHT);
    const z0 = Math.floor(pz - HALF);
    const z1 = Math.floor(pz + HALF);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) if (w.isSolid(x, y, z)) return true;
    return false;
  }

  /** Moves along one axis in small steps, snapping to the block face on contact. */
  private moveAxis(axis: 0 | 1 | 2, delta: number): boolean {
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / MAX_STEP));
    const step = delta / steps;
    for (let i = 0; i < steps; i++) {
      const p = this.pos;
      p.setComponent(axis, p.getComponent(axis) + step);
      if (!this.collidesAt(p.x, p.y, p.z)) continue;

      const v = p.getComponent(axis);
      if (axis === 1) {
        if (step < 0) {
          p.y = Math.floor(v) + 1;
          this.onGround = true;
        } else {
          p.y = Math.floor(v + PLAYER_HEIGHT) - PLAYER_HEIGHT - 0.001;
        }
      } else if (step > 0) {
        p.setComponent(axis, Math.floor(v + HALF) - HALF - 0.001);
      } else {
        p.setComponent(axis, Math.floor(v - HALF) + 1 + HALF + 0.001);
      }
      this.vel.setComponent(axis, 0);
      return true;
    }
    return false;
  }
}

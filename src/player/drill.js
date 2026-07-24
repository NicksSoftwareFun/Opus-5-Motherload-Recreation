import { BLOCKS, AIR, isOre } from '../world/blocks.js';
import { raycastVoxels } from '../world/raycast.js';

const REACH = 1.55;

/**
 * The drill.
 *
 * Targeting is a voxel raycast straight down the view axis, which is the whole
 * reason the crosshair is etched into the canopy rather than drawn on screen: where
 * you look, the boom points, and what it touches is what breaks. Progress is per
 * target — look away mid-cut and the rock you abandoned heals, which discourages
 * chewing at three blocks at once and keeps tunnels tidy.
 */
export class Drill {
  constructor(world, chunks, pod) {
    this.world = world;
    this.chunks = chunks;
    this.pod = pod;

    this.target = null;
    this.progress = 0;
    this.active = false;
    /** Set for one frame when a block is destroyed; read by FX and audio. */
    this.lastBreak = null;
    this.lastBlockedByCargo = 0;
  }

  /** The block currently under the crosshair, whether or not it can be cut. */
  aim(origin, direction) {
    return raycastVoxels(this.world, origin, direction, REACH);
  }

  static canCut(id) {
    const def = BLOCKS[id];
    return def && def.mineable && Number.isFinite(def.hardness);
  }

  /**
   * @returns {{ broke: object|null, cutting: boolean }}
   */
  update(dt, { origin, direction, wantDrill, elapsed = 0 }) {
    this.lastBreak = null;
    const hit = this.aim(origin, direction);

    // Losing the target — by looking away or by breaking through — resets the cut.
    const sameTarget =
      hit && this.target &&
      hit.vx === this.target.vx && hit.vy === this.target.vy && hit.vz === this.target.vz;
    if (!sameTarget) this.progress = 0;
    this.target = hit;

    const cuttable = hit && Drill.canCut(hit.id);
    this.active = Boolean(wantDrill && cuttable && this.pod.fuel > 0);

    if (!this.active) {
      // Bleed progress away slowly rather than snapping to zero, so a momentary
      // wobble off-target does not throw away three seconds of drilling.
      this.progress = Math.max(0, this.progress - dt * 0.35);
      return { broke: null, cutting: false };
    }

    // Fuel and heat for drilling are charged once, by Pod.update, which is told
    // whether the drill is active. Charging them here as well double-billed both.
    const def = BLOCKS[hit.id];
    this.progress += (dt * this.pod.drillPower) / def.hardness;

    if (this.progress < 1) return { broke: null, cutting: true };

    // Break through.
    this.progress = 0;
    this.chunks.setBlock(hit.vx, hit.vy, hit.vz, AIR);
    this.pod.stats.blocksDrilled++;

    const broke = {
      id: hit.id,
      vx: hit.vx, vy: hit.vy, vz: hit.vz,
      position: { x: hit.vx + 0.5, y: -hit.vy - 0.5, z: hit.vz + 0.5 },
      ore: isOre(hit.id),
      stowed: false,
      value: def.value,
      name: def.name,
      color: def.color,
    };

    if (broke.ore) {
      broke.stowed = this.pod.addOre(hit.id, def.units || 1);
      // A full bay does not stop you drilling; it just means the ore is scattered.
      if (!broke.stowed) this.lastBlockedByCargo = elapsed;
    }

    this.lastBreak = broke;
    this.target = null;
    return { broke, cutting: true };
  }

  /** 0..1 progress on the current target, for the dash readout. */
  get cutFraction() {
    return this.progress;
  }
}

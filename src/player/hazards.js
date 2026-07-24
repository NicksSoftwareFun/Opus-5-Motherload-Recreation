import { AIR, LAVA, GAS, BLOCKS, isSolid } from '../world/blocks.js';
import { PHYSICS, POD } from '../config.js';

/**
 * What the mine does to you.
 *
 * Four threats, each of which teaches a different lesson:
 *   - magma punishes not looking where you are going;
 *   - gas punishes drilling without checking what is next to the block;
 *   - collapses punish undercutting a ceiling;
 *   - quakes punish being deep at all.
 *
 * Everything here routes its damage through the pod's subsystem model, so a hazard
 * costs you a capability rather than just a number.
 */

const GAS_FUSE = 1.1;
const GAS_RADIUS = 2.4;
const COLLAPSE_CHECK = 6;

export class Hazards {
  constructor(world, chunks, pod, subsystems) {
    this.world = world;
    this.chunks = chunks;
    this.pod = pod;
    this.subsystems = subsystems;

    /** Gas pockets that have been opened and are counting down. */
    this.fuses = [];
    /** Blocks currently falling, as { vx, vy, vz, id, progress }. */
    this.falling = [];
    this.quakeTimer = 24 + Math.random() * 40;
    this.quake = 0;
    this.events = [];
  }

  _emit(kind, payload = {}) {
    this.events.push({ kind, ...payload });
  }

  /** Drain and return everything that happened since the last call. */
  drain() {
    const out = this.events;
    this.events = [];
    return out;
  }

  /**
   * Called whenever the drill breaks a block. Opens gas pockets and destabilises
   * whatever was resting on it.
   */
  onBlockRemoved(vx, vy, vz) {
    // Any gas now touching open air is a lit fuse.
    for (const [dx, dy, dz] of [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ]) {
      const nx = vx + dx;
      const ny = vy + dy;
      const nz = vz + dz;
      if (this.world.get(nx, ny, nz) !== GAS) continue;
      if (this.fuses.some((f) => f.vx === nx && f.vy === ny && f.vz === nz)) continue;
      this.fuses.push({ vx: nx, vy: ny, vz: nz, t: GAS_FUSE });
      this._emit('gas-lit', { position: cellCentre(nx, ny, nz) });
    }

    // Anything directly above with nothing to sit on may come down.
    for (let i = 1; i <= COLLAPSE_CHECK; i++) {
      const above = vy - i;
      const id = this.world.get(vx, above, vz);
      if (id === AIR) continue;
      if (!isSolid(id) || !BLOCKS[id].mineable) break;
      // Supported if any of its four horizontal neighbours is solid.
      const braced = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(
        ([dx, dz]) => isSolid(this.world.get(vx + dx, above, vz + dz)),
      );
      if (braced) break;
      this._startFall(vx, above, vz, id);
      break;
    }
  }

  _startFall(vx, vy, vz, id) {
    if (this.falling.some((f) => f.vx === vx && f.vy === vy && f.vz === vz)) return;
    this.chunks.setBlock(vx, vy, vz, AIR);
    this.falling.push({ vx, vy, vz, id, t: 0 });
    this._emit('collapse', { position: cellCentre(vx, vy, vz), id });
  }

  _detonate(fuse, podPosition) {
    const centre = cellCentre(fuse.vx, fuse.vy, fuse.vz);
    const r = Math.ceil(GAS_RADIUS);
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy + dz * dz > GAS_RADIUS * GAS_RADIUS) continue;
          const id = this.world.get(fuse.vx + dx, fuse.vy + dy, fuse.vz + dz);
          if (id === AIR || !BLOCKS[id].mineable) continue;
          this.chunks.setBlock(fuse.vx + dx, fuse.vy + dy, fuse.vz + dz, AIR);
        }
      }
    }
    // Clear any other pockets caught in the blast rather than chain-detonating.
    this.fuses = this.fuses.filter((f) => f === fuse || dist(cellCentre(f.vx, f.vy, f.vz), centre) > GAS_RADIUS);

    const d = dist(centre, podPosition);
    const falloff = Math.max(0, 1 - d / (GAS_RADIUS + 4));
    if (falloff > 0) {
      const damage = 34 * falloff;
      this.pod.damage(damage);
      const hit = this.subsystems.applyDamage(damage / 180);
      this.pod.addHeat(28 * falloff);
      this._emit('explosion', { position: centre, strength: falloff, damage, module: hit });
    } else {
      this._emit('explosion', { position: centre, strength: 0, damage: 0, module: null });
    }
  }

  update(dt, { position, velocity }) {
    // --- Magma contact ---
    // Checked against the pod's box rather than its centre, so clipping a corner
    // of a pool counts. Magma does not need long.
    const hx = PHYSICS.POD_HALF_W;
    const hy = PHYSICS.POD_HALF_H;
    let inLava = 0;
    for (const [ox, oy, oz] of [
      [0, 0, 0], [hx, 0, 0], [-hx, 0, 0], [0, hy, 0], [0, -hy, 0], [0, 0, hx], [0, 0, -hx],
    ]) {
      if (this.world.getAtWorld(position.x + ox, position.y + oy, position.z + oz) === LAVA) inLava++;
    }
    if (inLava > 0) {
      const severity = inLava / 7;
      this.pod.addHeat(POD.HEAT_MAX * 1.6 * severity * dt);
      const damage = 26 * severity * dt;
      this.pod.damage(damage);
      const hit = this.subsystems.applyDamage(damage / 90);
      this._emit('lava', { severity, module: hit, position });
    }

    // --- Gas fuses ---
    for (let i = this.fuses.length - 1; i >= 0; i--) {
      const fuse = this.fuses[i];
      fuse.t -= dt;
      if (fuse.t > 0) continue;
      this.fuses.splice(i, 1);
      // It may have been mined out or blown up in the meantime.
      if (this.world.get(fuse.vx, fuse.vy, fuse.vz) !== GAS) continue;
      this.chunks.setBlock(fuse.vx, fuse.vy, fuse.vz, AIR);
      this._detonate(fuse, position);
    }

    // --- Falling blocks ---
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const rock = this.falling[i];
      rock.t += dt;
      if (rock.t < 0.22) continue;
      rock.t = 0;
      const below = rock.vy + 1;
      const blocked = isSolid(this.world.get(rock.vx, below, rock.vz));
      const podCell = worldToCell(position);
      const hitsPod = rock.vx === podCell.vx && rock.vz === podCell.vz
        && Math.abs(below - podCell.vy) < 1;

      if (hitsPod) {
        const damage = 16;
        this.pod.damage(damage);
        const hit = this.subsystems.applyDamage(damage / 150);
        this._emit('rockfall-hit', { position: cellCentre(rock.vx, below, rock.vz), module: hit });
      }

      if (blocked || below >= this.world.h - 1) {
        this.chunks.setBlock(rock.vx, rock.vy, rock.vz, rock.id);
        this.falling.splice(i, 1);
        this._emit('rock-landed', { position: cellCentre(rock.vx, rock.vy, rock.vz) });
      } else {
        rock.vy = below;
      }
    }

    // --- Quakes ---
    // Only deep, and they get more frequent the further down you are.
    const depth = -position.y;
    if (depth > 70) {
      this.quakeTimer -= dt * (0.6 + depth / 260);
      if (this.quakeTimer <= 0) {
        this.quakeTimer = 40 + Math.random() * 70;
        this.quake = 1.6;
        this._emit('quake', { depth });
        // A quake shakes a few unsupported blocks loose nearby.
        const cell = worldToCell(position);
        for (let i = 0; i < 5; i++) {
          const vx = cell.vx + Math.floor((Math.random() - 0.5) * 9);
          const vz = cell.vz + Math.floor((Math.random() - 0.5) * 9);
          const vy = cell.vy - 1 - Math.floor(Math.random() * 4);
          const id = this.world.get(vx, vy, vz);
          if (isSolid(id) && BLOCKS[id].mineable
            && this.world.get(vx, vy + 1, vz) === AIR) {
            this._startFall(vx, vy, vz, id);
          }
        }
      }
    }
    this.quake = Math.max(0, this.quake - dt * 0.9);

    return this.quake;
  }
}

function cellCentre(vx, vy, vz) {
  return { x: vx + 0.5, y: -vy - 0.5, z: vz + 0.5 };
}

function worldToCell(position) {
  return {
    vx: Math.floor(position.x),
    vy: Math.floor(-position.y),
    vz: Math.floor(position.z),
  };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

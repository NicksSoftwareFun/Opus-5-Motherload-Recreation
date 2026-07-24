import { Pod } from '../player/pod.js';

/**
 * Persistence.
 *
 * A save is the world seed plus the list of voxels you have changed — never the
 * megabyte of voxel data itself. Regenerating from the seed is deterministic and
 * costs about 400 ms, and even a very long run only touches a few thousand blocks,
 * so a complete save is a handful of kilobytes.
 */

const KEY = 'motherload3d.save.v1';
const VERSION = 1;

export function hasSave() {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

export function saveGame({ seed, pod, position, modified, deepest = 0 }) {
  // Flatten the modification map into a single number array: [index, id, ...].
  const diff = new Array(modified.size * 2);
  let i = 0;
  for (const [index, id] of modified) {
    diff[i++] = index;
    diff[i++] = id;
  }

  const payload = {
    version: VERSION,
    savedAt: Date.now(),
    seed,
    pod: pod.toJSON(),
    position: [position.x, position.y, position.z],
    deepest,
    diff,
  };

  try {
    localStorage.setItem(KEY, JSON.stringify(payload));
    return { ok: true, blocks: modified.size, bytes: JSON.stringify(payload).length };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.version !== VERSION) return null;
    return {
      seed: data.seed,
      pod: Pod.fromJSON(data.pod),
      position: data.position,
      deepest: data.deepest ?? 0,
      diff: data.diff ?? [],
      savedAt: data.savedAt,
    };
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing we can do, and nothing that matters */
  }
}

/** Re-apply a saved diff onto a freshly generated world. */
export function applyDiff(world, diff) {
  for (let i = 0; i < diff.length; i += 2) {
    world.data[diff[i]] = diff[i + 1];
  }
  world.recountChunks();
}

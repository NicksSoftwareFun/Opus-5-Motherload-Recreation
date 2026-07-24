import * as THREE from 'three';

/**
 * Particle effects: drill spoil, sparks, ore bursts, and impact dust.
 *
 * One fixed-size pool drawn as a single Points cloud. Recycling the oldest particle
 * when the pool is exhausted means the effect budget can never spike, which matters
 * because drilling emits continuously for as long as the player holds the button.
 */
const MAX = 700;

export function createFX() {
  const positions = new Float32Array(MAX * 3);
  const colors = new Float32Array(MAX * 3);
  const sizes = new Float32Array(MAX);

  const velocity = new Float32Array(MAX * 3);
  const life = new Float32Array(MAX);
  const maxLife = new Float32Array(MAX);
  const gravity = new Float32Array(MAX);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  // Additive point sprites with per-particle size; a tiny shader beats juggling
  // several PointsMaterials with different sizes.
  const material = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: /* glsl */ `
      attribute float size;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(size * (420.0 / max(-mv.z, 0.35)), 1.0, 26.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = dot(d, d);
        if (r > 0.25) discard;
        float a = 1.0 - smoothstep(0.05, 0.25, r);
        gl_FragColor = vec4(vColor, a);
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;

  let cursor = 0;
  let sprayClock = 0;
  const color = new THREE.Color();

  function spawn(x, y, z, vx, vy, vz, hex, size, ttl, grav) {
    const i = cursor;
    cursor = (cursor + 1) % MAX;
    const i3 = i * 3;
    positions[i3] = x; positions[i3 + 1] = y; positions[i3 + 2] = z;
    velocity[i3] = vx; velocity[i3 + 1] = vy; velocity[i3 + 2] = vz;
    color.setHex(hex);
    colors[i3] = color.r; colors[i3 + 1] = color.g; colors[i3 + 2] = color.b;
    sizes[i] = size;
    life[i] = ttl;
    maxLife[i] = ttl;
    gravity[i] = grav;
  }

  const rand = (s) => (Math.random() - 0.5) * s;

  return {
    points,

    /**
     * Continuous spoil thrown off the bit while cutting.
     *
     * Rate-limited on its own clock rather than emitting per simulation step: the
     * fixed step runs at 120 Hz, and emitting on every one of those filled the whole
     * pool in a fraction of a second and turned the tunnel into a white-out.
     */
    drillSpray(dt, pos, normal, hex) {
      sprayClock += dt;
      if (sprayClock < 0.045) return;
      sprayClock = 0;

      for (let i = 0; i < 2; i++) {
        spawn(
          pos.x + rand(0.25), pos.y + rand(0.25), pos.z + rand(0.25),
          normal.x * 1.4 + rand(1.6), normal.y * 1.4 + rand(1.6) + 0.6, normal.z * 1.4 + rand(1.6),
          hex, 0.016 + Math.random() * 0.014, 0.35 + Math.random() * 0.4, 5.2,
        );
      }
      // A hot spark or two: the bit is grinding, not scooping.
      if (Math.random() < 0.5) {
        spawn(
          pos.x + rand(0.1), pos.y + rand(0.1), pos.z + rand(0.1),
          rand(3.5), rand(3.5) + 1.0, rand(3.5),
          0xffd9a0, 0.010, 0.16 + Math.random() * 0.15, 7,
        );
      }
    },

    /** The block gives way: a burst in the block's own colour. */
    blockBurst(pos, hex, ore = false) {
      const n = ore ? 24 : 13;
      for (let i = 0; i < n; i++) {
        spawn(
          pos.x + rand(0.6), pos.y + rand(0.6), pos.z + rand(0.6),
          rand(4.5), rand(4.5) + 0.8, rand(4.5),
          hex, ore ? 0.024 : 0.018, 0.5 + Math.random() * 0.6, 5.2,
        );
      }
      if (ore) {
        // A flash of white with the ore burst — the moment worth looking up for.
        for (let i = 0; i < 10; i++) {
          spawn(
            pos.x + rand(0.4), pos.y + rand(0.4), pos.z + rand(0.4),
            rand(2.4), rand(2.4) + 1.4, rand(2.4),
            0xffffff, 0.013, 0.35 + Math.random() * 0.4, 3.4,
          );
        }
      }
    },

    /** Dust kicked up on a hard landing. */
    impactDust(pos, strength) {
      const n = Math.min(30, 6 + Math.floor(strength * 1.6));
      for (let i = 0; i < n; i++) {
        spawn(
          pos.x + rand(0.7), pos.y - 0.3, pos.z + rand(0.7),
          rand(2.6), Math.random() * 1.2, rand(2.6),
          0xa87a58, 0.030, 0.6 + Math.random() * 0.7, 2.0,
        );
      }
    },

    update(dt) {
      for (let i = 0; i < MAX; i++) {
        if (life[i] <= 0) {
          sizes[i] = 0;
          continue;
        }
        life[i] -= dt;
        const i3 = i * 3;
        velocity[i3 + 1] -= gravity[i] * dt;
        positions[i3] += velocity[i3] * dt;
        positions[i3 + 1] += velocity[i3 + 1] * dt;
        positions[i3 + 2] += velocity[i3 + 2] * dt;
        // Fade by shrinking: additive sprites read better shrinking than dimming.
        const t = Math.max(0, life[i] / maxLife[i]);
        sizes[i] = sizes[i] > 0 ? Math.max(0.001, sizes[i]) * (0.965 + 0.035 * t) : 0;
        if (life[i] <= 0) sizes[i] = 0;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      geo.attributes.size.needsUpdate = true;
    },
  };
}

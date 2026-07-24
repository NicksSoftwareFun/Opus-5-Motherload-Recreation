import * as THREE from 'three';
import { RENDER, PALETTE } from '../config.js';

/**
 * Renderer, camera, sky and the global lighting rig.
 *
 * The single most important environmental trick here is `setDepth()`: as the pod
 * descends, sunlight and ambient fill are driven to nothing and the fog closes in,
 * so the mine goes genuinely dark and the pod's headlights become the only thing
 * keeping you alive. Everything else in the game reads better because of it.
 */

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uHigh;
  uniform vec3 uLow;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uExposure;
  varying vec3 vDir;

  void main() {
    vec3 dir = normalize(vDir);
    // Martian sky: dusty butterscotch at the horizon fading to a bruised violet above.
    float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    float band = pow(clamp(1.0 - dir.y, 0.0, 1.0), 2.2);
    vec3 col = mix(uHigh, uLow, band);

    // Broad forward-scattered halo — Mars has no crisp sun, it has a smear of light.
    float sd = max(dot(dir, normalize(uSunDir)), 0.0);
    col += uSunColor * pow(sd, 6.0) * 0.30;
    col += uSunColor * pow(sd, 220.0) * 1.6;

    // Ground haze below the horizon so the terrain edge never reads as a hard seam.
    col = mix(col, uLow * 0.55, smoothstep(0.0, -0.25, dir.y));

    gl_FragColor = vec4(col * uExposure, 1.0);
  }
`;

export function createScene(canvasParent = document.body) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = RENDER.SHADOWS;
  canvasParent.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(PALETTE.dust, RENDER.FOG_SURFACE);

  const camera = new THREE.PerspectiveCamera(
    RENDER.FOV,
    window.innerWidth / window.innerHeight,
    RENDER.NEAR,
    RENDER.FAR,
  );

  // Low sun angle: long shadows, warm rake across the terrain, and it gives the
  // surface base a definite time of day rather than flat noon lighting.
  const sunDir = new THREE.Vector3(0.42, 0.36, -0.83).normalize();

  const skyUniforms = {
    uHigh: { value: new THREE.Color(PALETTE.skyHigh) },
    uLow: { value: new THREE.Color(PALETTE.skyLow) },
    uSunColor: { value: new THREE.Color(PALETTE.sun) },
    uSunDir: { value: sunDir.clone() },
    uExposure: { value: 1 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(600, 32, 20),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  scene.add(sky);

  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.1);
  sun.position.copy(sunDir).multiplyScalar(220);
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(PALETTE.skyLow, PALETTE.groundDark, 0.85);
  scene.add(hemi);

  const sunBase = sun.intensity;
  const hemiBase = hemi.intensity;

  const state = {
    renderer,
    scene,
    camera,
    sky,
    sun,
    hemi,
    sunDir,

    /**
     * Drive the environment from the pod's depth (metres below the surface).
     * Daylight dies over the first ~14 m; fog thickens over the first ~22 m.
     */
    setDepth(depth) {
      const d = Math.max(0, depth);
      const light = Math.max(0, 1 - d / 14);
      const shade = light * light;
      sun.intensity = sunBase * shade;
      hemi.intensity = hemiBase * (0.06 + 0.94 * shade);
      skyUniforms.uExposure.value = Math.max(0.015, shade);

      const t = Math.min(1, d / 22);
      scene.fog.density = RENDER.FOG_SURFACE + (RENDER.FOG_UNDERGROUND - RENDER.FOG_SURFACE) * t;
      scene.fog.color.setHex(PALETTE.dust).lerp(new THREE.Color(0x120a06), t);
    },

    resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
  };

  window.addEventListener('resize', state.resize);
  return state;
}

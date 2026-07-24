/**
 * OpenTrack head tracking client.
 *
 * Connects to the local bridge (tools/opentrack-bridge.mjs) over WebSocket and
 * turns each pose into a head offset the cockpit can apply.
 *
 * The tracker only ever moves the pilot's *head inside the cabin* — it never
 * steers. Mouse yaw still drives the pod through the follow detent, and tracker
 * yaw is layered on top, so leaning to see past the canopy pillar or dipping your
 * head to read the terminal does exactly what it does in a real machine and does
 * not send the pod into a spin.
 *
 * Everything about it is optional. If the bridge is not running, the client
 * retries quietly in the background and the game is mouse-only.
 */

const DEFAULTS = {
  url: 'ws://127.0.0.1:4243',
  /** Degrees of real head rotation -> radians in game, per axis. */
  yawGain: 1.35,
  pitchGain: 1.2,
  rollGain: 0.55,
  /** Millimetres of real head translation -> metres of cabin lean. */
  leanGain: 0.0016,
  /** Clamps, so a tracking glitch cannot bury the camera in the bulkhead. */
  maxYaw: 2.2,
  maxPitch: 1.1,
  maxRoll: 0.5,
  maxLean: 0.14,
  /** Exponential smoothing rate. Higher is snappier and noisier. */
  smoothing: 18,
  /** Drop to disconnected if no packet arrives for this long. */
  timeout: 1.5,
  retryDelay: 3000,
};

const DEG = Math.PI / 180;
const clamp = (v, m) => (v < -m ? -m : v > m ? m : v);

export function createHeadTracking(options = {}) {
  const cfg = { ...DEFAULTS, ...options };

  // ?track=off disables it entirely; ?track=host:port points at another machine.
  const param = typeof location !== 'undefined'
    ? new URLSearchParams(location.search).get('track')
    : null;
  const disabled = param === 'off';
  if (param && param !== 'off' && param !== 'on') cfg.url = `ws://${param}`;

  /** Raw values from the last packet, before centring. */
  const raw = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, z: 0 };
  /** Centre reference captured by recentre(). */
  const zero = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, z: 0 };
  /** Smoothed, centred, clamped output in game units. */
  const pose = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, z: 0 };
  const target = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, z: 0 };

  let socket = null;
  let connected = false;
  let sincePacket = Infinity;
  let retryTimer = null;
  let packets = 0;

  function connect() {
    if (disabled || socket) return;
    try {
      socket = new WebSocket(cfg.url);
    } catch {
      scheduleRetry();
      return;
    }

    socket.onopen = () => {
      connected = true;
      sincePacket = 0;
    };

    socket.onmessage = (event) => {
      try {
        const p = JSON.parse(event.data);
        raw.yaw = p.yaw;
        raw.pitch = p.pitch;
        raw.roll = p.roll;
        raw.x = p.x;
        raw.y = p.y;
        raw.z = p.z;
        // The first packet defines centre, so the pilot does not have to recentre
        // manually just to start looking straight ahead.
        if (packets === 0) Object.assign(zero, raw);
        packets++;
        sincePacket = 0;
        connected = true;
      } catch {
        /* a malformed packet is not worth a stack trace */
      }
    };

    const drop = () => {
      connected = false;
      socket = null;
      scheduleRetry();
    };
    socket.onclose = drop;
    socket.onerror = () => socket?.close();
  }

  function scheduleRetry() {
    if (disabled || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, cfg.retryDelay);
  }

  connect();

  return {
    pose,
    get connected() { return connected && sincePacket < cfg.timeout; },
    get available() { return !disabled; },
    get packets() { return packets; },
    config: cfg,

    /** Take the current head position as the neutral, forward-facing pose. */
    recentre() {
      Object.assign(zero, raw);
    },

    update(dt) {
      sincePacket += dt;

      if (!this.connected) {
        // Ease back to neutral rather than freezing at whatever the last pose was.
        for (const k of Object.keys(target)) target[k] = 0;
      } else {
        target.yaw = clamp((raw.yaw - zero.yaw) * DEG * cfg.yawGain, cfg.maxYaw);
        target.pitch = clamp((raw.pitch - zero.pitch) * DEG * cfg.pitchGain, cfg.maxPitch);
        target.roll = clamp((raw.roll - zero.roll) * DEG * cfg.rollGain, cfg.maxRoll);
        target.x = clamp((raw.x - zero.x) * cfg.leanGain, cfg.maxLean);
        target.y = clamp((raw.y - zero.y) * cfg.leanGain, cfg.maxLean);
        target.z = clamp((raw.z - zero.z) * cfg.leanGain, cfg.maxLean);
      }

      const k = Math.min(1, dt * cfg.smoothing);
      for (const key of Object.keys(pose)) {
        pose[key] += (target[key] - pose[key]) * k;
      }
    },
  };
}

/**
 * Session state machine.
 *
 * The game opens in a cold, dark cockpit. There is no title card: you throw the
 * master power switch, the terminal runs its self-test, and the menu that appears
 * on that screen is the main menu. Powering down mid-run is allowed and does
 * exactly what you would expect, which is the point — the machine is the interface.
 */

export const PHASE = {
  COLD: 'cold',
  BOOT: 'boot',
  MENU: 'menu',
  FLYING: 'flying',
  RESCUE: 'rescue',
  ENDING: 'ending',
};

/** Self-test lines, revealed one at a time. The last one is not a typo. */
export const POST_LINES = [
  { text: 'NATAS HEAVY INDUSTRIES', kind: 'head' },
  { text: "EXCAVATION POD 'MOLE' - MDL 7", kind: 'head' },
  { text: 'BIOS 4.11  (C) NATAS HEAVY IND.', kind: 'head' },
  { text: '', kind: 'gap' },
  { text: 'CORE MEMORY', result: '640K OK' },
  { text: 'DRILL CONTROLLER', result: 'OK' },
  { text: 'THRUSTER BUS', result: 'OK' },
  { text: 'FUEL CELL', result: 'OK' },
  { text: 'HULL SENSOR ARRAY', result: 'OK' },
  { text: 'CARGO BAY SERVO', result: 'OK' },
  { text: 'HEAT EXCHANGER', result: 'OK' },
  { text: 'COMMS UPLINK', result: 'NATAS' },
  { text: 'LIFE SUPPORT', result: 'OK' },
  { text: 'LIEN ON HOLDER', result: 'ACTIVE', kind: 'odd' },
  { text: '', kind: 'gap' },
  { text: 'SELF TEST COMPLETE', kind: 'head' },
];

const LINE_INTERVAL = 0.14;
const MENU_DELAY = 0.7;

export class Session {
  constructor({ pod, onStartRun = null, hasSave = () => false } = {}) {
    this.pod = pod;
    this.phase = PHASE.COLD;
    this.power = false;
    this.onStartRun = onStartRun;
    this.hasSave = hasSave;

    this.bootTime = 0;
    this.revealed = 0;
    /** Terminal page currently selected on the centre console. */
    this.page = 'status';
    this.notice = null;
    this._noticeTimer = 0;
    this.rescue = null;
    this.endingAt = 0;
  }

  get booted() {
    return this.phase === PHASE.FLYING || this.phase === PHASE.RESCUE || this.phase === PHASE.ENDING;
  }

  /** Can the pod actually do anything? Everything is dead without master power. */
  get systemsLive() {
    // The ending does not take the controls away. You opened it; you can fly out.
    return this.power && (this.phase === PHASE.FLYING || this.phase === PHASE.ENDING);
  }

  setPower(on) {
    this.power = on;
    if (on) {
      if (this.phase === PHASE.COLD) {
        this.phase = PHASE.BOOT;
        this.bootTime = 0;
        this.revealed = 0;
      }
    } else {
      this.phase = PHASE.COLD;
      this.bootTime = 0;
      this.revealed = 0;
    }
  }

  /** Transient line shown on the terminal — refuelling, sales, warnings. */
  post(message, seconds = 3.5) {
    this.notice = message;
    this._noticeTimer = seconds;
  }

  /** Hull gone, or stranded with a dry tank. Natas comes and gets you. */
  beginRescue(reason, fee) {
    if (this.phase === PHASE.RESCUE) return;
    this.phase = PHASE.RESCUE;
    this.rescue = { reason, fee, t: 0 };
    this.page = 'rescue';
  }

  completeRescue() {
    this.phase = PHASE.FLYING;
    this.page = 'status';
    this.rescue = null;
    this.endingAt = 0;
  }

  /** The Seal is open. The contract is over; the pod still works. */
  beginEnding() {
    if (this.phase === PHASE.ENDING) return;
    this.phase = PHASE.ENDING;
    this.page = 'ending';
    this.endingAt = 0;
  }

  startRun(fresh = true) {
    this.phase = PHASE.FLYING;
    this.page = 'status';
    this.onStartRun?.(fresh);
  }

  update(dt) {
    if (this._noticeTimer > 0) {
      this._noticeTimer -= dt;
      if (this._noticeTimer <= 0) this.notice = null;
    }

    if (this.phase === PHASE.RESCUE && this.rescue) this.rescue.t += dt;
    if (this.phase === PHASE.ENDING) this.endingAt += dt;
    if (this.phase !== PHASE.BOOT) return;
    this.bootTime += dt;
    this.revealed = Math.min(POST_LINES.length, Math.floor(this.bootTime / LINE_INTERVAL));
    if (this.revealed >= POST_LINES.length && this.bootTime > POST_LINES.length * LINE_INTERVAL + MENU_DELAY) {
      this.phase = PHASE.MENU;
    }
  }
}

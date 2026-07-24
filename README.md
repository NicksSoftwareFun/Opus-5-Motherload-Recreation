# MOTHERLOAD 3D

A browser-based 3D reimagining of the Flash game *Motherload*. You operate a one-seat
mining pod on Mars under contract to the financier **Mr. Natas**: dig, haul ore to the
surface, sell it, upgrade the pod, dig deeper. Something is waiting at the bottom.

Built with [three.js](https://threejs.org/) and Vite. Every model and texture is
generated procedurally in code — the repository contains no art assets, only the
screenshots below.

![The pod terminal, gauge cluster and LED ladders](docs/screenshots/terminal.png)

## Screenshots

Every one of these is the real game, captured by the headless harness driving the
same code paths a player does. There is no HUD in any of them, because there is no
HUD anywhere in the project.

| | |
| --- | --- |
| ![A cold, dark cockpit with the standby lamp pulsing](docs/screenshots/cold-start.png) **Cold start.** The game opens with the pod switched off. A pulsing standby lamp throws amber light across the switch panel — the entire tutorial for how to begin. | ![The self-test menu on the pod terminal](docs/screenshots/boot-menu.png) **The main menu is a boot screen.** Throw master power, the terminal POSTs, and NEW EXCAVATION is a button on that CRT. Note the last line of the self-test. |
| ![The left-hand switch bank](docs/screenshots/switch-bank.png) **The switch bank.** Master power, exterior lamps, drill clutch, cargo release and the map projector. You look at them and click them; the headlights are not a keybind. | ![The surface base seen through the canopy](docs/screenshots/base.png) **The claim.** Six installations ring the shaft mouth, each with a pad, a lit sign and a silhouette you can navigate by. |
| ![Drilling downward with spoil flying from the bit](docs/screenshots/drilling.png) **Cutting.** The drill points wherever you look, and the sight is the boom's own optics. Ore is the only thing that glows down here. | ![The upgrade console at the fitting shop](docs/screenshots/workshop.png) **Docking is proximity.** Land on a pad and your own terminal becomes that vendor's console. No shop overlay, nothing to dismiss. |
| ![The chase camera feed on the right console](docs/screenshots/chase-feed.png) **Hull optics.** Three cameras, one CRT, one rotary knob. It is the only way to ever see the machine you are flying. | ![The volumetric mine map projected above the dash](docs/screenshots/hologram.png) **The mine map.** A projector on the dash throws up the claim with every metre you have cut, your pod inside it, and a tether to the surface. |

## Running it

```bash
npm install
npm run dev      # http://127.0.0.1:5173
```

```bash
npm run build    # static bundle in dist/
npm run preview  # serve the built bundle
npm test         # unit tests
npm run shots    # headless screenshot harness -> shots/
```

## Head tracking (OpenTrack)

Optional, and off unless you run the bridge. A browser cannot open a UDP socket and
OpenTrack cannot speak WebSocket, so a small Node process sits between them:

```bash
npm run track      # binds udp://127.0.0.1:4242, serves ws://127.0.0.1:4243
```

In OpenTrack, set **Output** to *UDP over network*, remote host `127.0.0.1`, remote
port `4242`. Start tracking, then load the game — it connects on its own and retries
quietly in the background, so the bridge can be started or stopped at any time.

The tracker only moves the pilot's head **inside the cabin**. Mouse yaw still steers
the pod through the follow detent, and the detent reads only the mouse component, so
leaning to see past a canopy pillar or dipping your head to read the terminal never
sends the pod into a spin. Positional tracking is wired to real parallax against the
canopy frame and the side consoles.

- `F9`, or the button on the terminal's SYS page, recentres. The first pose received
  also becomes centre automatically.
- `?track=off` disables it. `?track=host:port` points at a bridge on another machine.
- Gains, clamps and smoothing live in `DEFAULTS` in `src/core/headTracking.js`. If an
  axis moves the wrong way, negate its gain — OpenTrack's sign conventions depend on
  which tracker and filter chain you are using.

## Design rules

Two rules drive nearly every decision in this codebase:

**Everything is diegetic.** There is no HUD, no menu, and no dialog drawn over the
scene. Fuel is a needle on a gauge. Hull integrity is a row of lamps. The shop is a
CRT terminal bolted to the console. The main menu is the pod's boot self-test. The
document body contains a `<canvas>` and nothing else, and the screenshot harness
asserts it on every run so this cannot quietly erode.

**It should feel like operating machinery.** The interface language is MicroProse's,
and specifically *Carrier Command 2* (2021): physical switches you throw, chunky
monochrome phosphor screens in thick bezels, a holographic map projector, per-module
damage instead of a single health bar, and mission traffic that clatters out of a
dot-matrix teletype beside the seat.

## Layout

| Path | What lives there |
| --- | --- |
| `src/core/` | Seeded RNG and noise, fixed-timestep loop, input |
| `src/world/` | Voxel storage, terrain generation, chunk meshing |
| `src/player/` | Pod state, physics, drilling, subsystems, hazards |
| `src/render/` | Scene and sky, surface, cockpit, instruments, effects |
| `src/ui/` | Diegetic CRT screens and the panels drawn onto them |
| `src/game/` | Economy, narrative, saves, session state machine |
| `scripts/` | Headless capture harness |

Coordinates: world space is metres, Y-up, and **Y = 0 is the Martian surface**. The
mine occupies a 64 × 64 m claim extending 256 m straight down, so a voxel's depth in
metres is simply `-y`.

## Status

Under construction. See `git log` — the game is built in numbered phases, each of
which leaves the build runnable.

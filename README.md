# MOTHERLOAD 3D

A browser-based 3D reimagining of the Flash game *Motherload*. You operate a one-seat
mining pod on Mars under contract to the financier **Mr. Natas**: dig, haul ore to the
surface, sell it, upgrade the pod, dig deeper. Something is waiting at the bottom.

Built with [three.js](https://threejs.org/) and Vite. Every model and texture is
generated procedurally in code — the repository contains no binary assets.

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

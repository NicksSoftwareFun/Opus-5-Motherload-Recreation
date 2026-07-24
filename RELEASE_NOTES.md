# MOTHERLOAD 3D — v1.0.0

A 3D reimagining of the Flash game *Motherload*, in your browser. You operate a
one-seat mining pod on Mars under contract to the financier **Mr. Natas**: dig, haul
ore up, sell it, upgrade, dig deeper. Something is waiting at the bottom.

There is no HUD. Every gauge, menu, shop and warning light is a physical object inside
the cockpit.

## Download and run

**Option 1 — one file, no install.** Download **`motherload-3d.html`** from the assets
below and double-click it. That's the whole game: 680 KB, one file, no server, no
internet connection needed after the download. It works because nothing is fetched at
runtime — every texture, model and screen in the game is drawn procedurally when it
boots.

Your progress saves to the browser's local storage, so opening the same file again
resumes where you left off.

**Option 2 — from source.**

```bash
git clone https://github.com/NicksSoftwareFun/Opus-5-Test-Box.git
cd Opus-5-Test-Box
npm install
npm run dev
```

Then open the URL it prints (http://127.0.0.1:5173).

**Requirements:** any current Chrome, Edge or Firefox with WebGL2, and a mouse. No
GPU-specific features are used, but a discrete GPU makes the deep mine much smoother.

## Starting the game

**The pod is switched off when you arrive.** This is deliberate and it is the only
thing you need to be told.

1. Click once to capture the mouse.
2. Look to your left. A pulsing amber **STANDBY** lamp is throwing light across a
   panel of switches.
3. Put the crosshair on the **MASTER** switch beneath it and click.
4. The terminal in the middle of the dash runs a self-test, then shows the menu.
   Click **NEW EXCAVATION**.

## Controls

| Input | Does |
| --- | --- |
| `W` `A` `S` `D` | Thrust |
| `Space` | Lift |
| `Ctrl` / `Shift` | Descend |
| Mouse | Move your head. Past a detent, the pod turns to follow your gaze |
| Left click | Drill whatever the sight is on — **or** operate the switch, knob or screen region it is resting on |
| `F9` | Recentre head tracker |

There are no other keybinds, because everything else is a switch you throw or a button
on a screen. The exterior lamps, the drill clutch, the map projector and the cargo
release are all on the left rail. The camera feed selector is a rotary knob on the
right.

The in-game **MANUAL** tab on the terminal has the ore price table, hazard notes and
this control list, so you never have to alt-tab.

## The loop

Drill down, fill the cargo bay, fly back up, and land on a pad. Landing establishes an
uplink and your own terminal becomes that vendor's console — there is no shop window.

- **ORE TRADER** — sell the bay.
- **FUEL DEPOT** — hydrazine, billed to the contract.
- **REPAIR RIG** — hull plating, and refits for individual damaged modules.
- **FITTING SHOP** — six upgrade lines of six tiers.
- **SENSOR BUREAU** — six instruments, each of which physically appears in your cabin.
- **UPLINK TOWER** — save your contract.

Lose the hull, or run the tank dry away from the surface, and Mr. Natas comes and
collects you. He charges for it. You keep your fittings.

## Optional: head tracking

The game supports [OpenTrack](https://github.com/opentrack/opentrack). A browser
cannot read UDP, so run the included bridge:

```bash
npm run track
```

Set OpenTrack's **Output** to *UDP over network*, host `127.0.0.1`, port `4242`. The
game connects on its own. The tracker moves your head inside the cabin — including
leaning, with real parallax against the canopy frame — while the mouse keeps steering
the pod.

## Notable

- **Everything is diegetic.** The main menu is the pod's boot self-test. The game-over
  screen is the emergency channel on the same terminal you were reading a moment ago.
  The document body contains a canvas and nothing else, and the test harness asserts
  it on every run.
- **Per-module damage.** A bad landing does not cost you thirty points, it costs you a
  headlight, or half your thrust, with the surface two hundred metres up.
- **The Providence Engine.** The top sensor tier costs 666,000 credits, is sold without
  a specification, is armed from under a safety cover, and shows you every ore seam and
  magma pocket within forty metres straight through solid rock. It bills you
  continuously while armed. When your credit runs out it does not stop.
- **No art assets.** Every texture, model, gauge face and CRT page in the game is
  generated in code at boot. That is why the whole thing fits in a single HTML file.

## Known limitations

- Software rendering (a machine with no GPU) will run this, but slowly.
- Audio is not implemented.
- The claim is a fixed 64 × 64 × 256 m and the world seed is fixed per build.

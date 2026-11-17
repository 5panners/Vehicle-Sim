# Vehicle Sim Sandbox

A data-driven, simulation-grade vehicle physics base for racing and driving games,
with a browser test environment (track, jumps, ten surfaces), keyboard, and full
game controller / wheel support with calibration.

The physics core (`src/physics/`) has **zero dependencies**. It doesn't know about
Three.js, the DOM, or input. Port it to another engine, or drop it into any JS game.

## Run it

```bash
node tools/serve.js
```

Then open http://localhost:8080. Any static file server works, but ES modules need http://, not file://.

```bash
npm run test:physics
```

```bash
npm run test:walls
```

`test:physics` is a headless regression run: 0–100 km/h, braking g, steady-state cornering g,
and stability runs (with lane keeping) through every jump lane, for every preset. `test:walls` crashes
five cars into a wall head-on, at glancing angles up to 220 km/h and sideways, checking for
pass-through and stability.

## Controls

| Action | Keyboard | Xbox-style pad |
|---|---|---|
| Throttle / brake | W S · ↑ ↓ | RT / LT (analog) |
| Steer | A D · ← → | Left stick |
| Handbrake | Space | A |
| Shift up / down | E / Q | B / X |
| Clutch | Z | LB |
| Camera / look back | C / B | Y / RB |
| Reset car | R | View/Back |
| Telemetry | T | D-pad up |
| Controls & calibration | Esc | Start |
| Tuning panel | Tab | — |
| Spawn points | F (cycle), 1–8 | — |
| Next/prev car | ] / [ | — |
| Auto/manual gearbox | G | (pressing a shift button switches to manual) |
| Units (mph default) / mute / slow-mo / help | U / M / P / H | — |
| Track map on/off | N | — |
| Practice opponent on/off / skill | O / K | — |
| Next map (reloads) | L | — |

**Track map:** a north-up map at the bottom centre (70% opacity) showing the circuit, the walls in red, the start line and the infield test areas, with your car as a heading arrow. Off the map, the arrow sits hollow on the edge. On narrow windows the map moves to the top right.

**Drift meter** (every car): slide past 12° above 20 km/h and the HUD shows live angle and a combo (angle × speed). Recover for 1.2 s to bank it into your total; spinning out or crashing loses it. Resets on spawn.

In automatic mode, hold the brake at a standstill to engage reverse.

## Controller support & calibration (Esc / Start)

- **Any Gamepad API device:** pads, wheels, pedals, shifters, button boxes. Pick the device from the list. The "standard mapping" pads (Xbox, PlayStation, most modern pads) get sensible bindings automatically.
- **Bind wizard:**
  - **Steering:** click *Bind*, turn fully right and hold, then fully left and hold. This captures the axis, both extremes and the centre, so off-centre or asymmetric wheels work.
  - **Pedals and triggers:** press fully and hold. The wizard records the rest value and the full-travel value, so inverted pedals (rest at +1) and short-travel pedals (only reach −0.4) map to a clean 0–1.
  - **Buttons:** press the button.
- **Per-axis response curves:** inner deadzone, outer saturation and linearity (γ), with a live in→out plot.
- **Re-centre and Invert** per axis.
- **Steering mode:**
  - *Gamepad:* rate-limited, speed-sensitive lock, countersteer assist.
  - *Wheel:* direct 1:1, no filtering. Unrecognised devices default to linear, no-deadzone steering.
- **Rumble (dual-rumble):** strong motor = landings, impacts and the rev limiter. Weak motor = tyre slip past peak, ABS pulses and surface roughness. Strength slider and a test button.
- **Gamepad navigation:** the setup screen is navigable with the pad itself (D-pad, A to select, B or Start to close).
- **Saved profiles:** saved per device ID in `localStorage`.

## Maps

Switch with **L**, or the **Map** dropdown in the Tab panel (the page reloads with `?map=<id>`). The last map you used is remembered.

| Map | What it is |
|---|---|
| `test` | The proving ground: start pad, skidpad, surface strips, jump park, circuit and walled section (below). |
| `brands` | **Brands Hatch GP** (3.908 km, clockwise). See below. |

### Brands Hatch GP

![Pit straight](docs/screenshots/brands-pit-straight.jpg)

- **Geometry:**
  - The centreline was extracted from a scaled layout diagram by `tools/extract-track.py` and validated: the diagram's Indy loop measures 1,947 m against the real 1,929 m.
  - It's rotated to true north using satellite imagery.
  - Curvature-adaptive smoothing irons the image-trace wobble out of the straights while keeping the corners (Druids ~29 m radius, Paddock ~63 m, Stirling's ~40 m).
  - Brabham Straight is "faired": the diagram's direction arrow put a false S-bend in it, so that stretch is replaced by the smoothest curve that joins Clark Curve and Paddock Hill (one gentle right-hand arc, as on the real circuit). Cooper Straight runs 74–90 m behind it.
- **Elevation (measured):**
  - The Indy sections (start line to Surtees, and Clark Curve to the line) use the "Raw Elevation" chart, digitised directly from the image: 176.7–195.3 m ASL.
  - The steepest grade is Paddock Hill at ~12%.
  - The GP-only loop (Pilgrim's Drop round to Clearways) isn't in the chart. It's shaped from the circuit's character inside the measured 19 m envelope, with matching values at both junctions.
  - The data is in `src/world/maps/brands-hatch-elevation.js`. Camber is estimated, including off-camber Stirling's, and its direction is fixed per corner.
  - The pit lane, garage apron and garages sit on a flat shelf that follows the straight's gradient. Beyond the paddock road the ground falls ~12 m to Cooper Straight, as the measured profile requires.
- **Track:**
  - Width is 15 m on Brabham Straight, ~12.5 m around the Indy loop and ~11 m through the GP loop.
  - Kerbs only through the corners, with green-painted run-off beside them.
  - Sandy gravel traps outside Paddock, Druids, Graham Hill, Surtees, Hawthorn, Westfield, Stirling's and Clark; tarmac run-off at Clearways. Each sits on a fixed side, tapers in and out, and lies flat.
- **Barriers:**
  - Black tyre walls with orange markers behind the gravel and run-off; silver double-rail Armco elsewhere. Barriers ease out around the traps instead of stepping.
  - A concrete pit wall, and catch fencing around the spectator areas.
- **Pit lane:** the entry lane peels off the inside of Clark Curve and the exit lane rejoins on the inside before Paddock Hill, each with white edge lines and a grass island; no kerbs where they join.
- **Buildings (low-poly, modelled on reference photos):**
  - **Pits:** two-storey pit garages with roller doors, a glazed upper floor and a red fascia; the race control tower with its red drum top; team trucks on the paddock road behind the garages.
  - **Hospitality and media:** the white multi-storey hospitality/media blocks.
  - **Grandstands:** scaffold stands with red seats and banners on Brabham Straight, at Paddock Hill and at Druids; a covered blue-seat stand at Clark Curve.
  - **Other buildings:** red hospitality barns, Hailwoods and the Kentagon.
- **Trackside:**
  - The advertising bridge at the top of Hailwood Hill, plus footbridges on Pilgrim's Drop and before Stirling's.
  - Floodlight masts, ad boards and marshal posts behind the barriers, and 3/2/1 brake boards.
  - Buildings step with the ground segment by segment, so none float on slopes.
- **Landscape:**
  - Woodland of oak, beech/ash, silver birch, bare spring trees and a few Scots pines, rendered with distance detail levels in culled tiles.
  - Mowed grass stripes on the banks, West Kingsdown housing, the M20 and a car park.
  - Buildings have collision.
- **Spawn points:** the grid, the pit lane, and approaches to Paddock Hill, Druids, Pilgrim's Drop, Hawthorn, Westfield, Dingle Dell and Clearways.

| | |
|---|---|
| ![Paddock Hill](docs/screenshots/brands-paddock-hill.jpg) | ![Hailwood Hill to Druids](docs/screenshots/brands-hailwood-hill-druids.jpg) |
| ![Woods near Westfield](docs/screenshots/brands-woods-westfield.jpg) | ![Pit lane](docs/screenshots/brands-pit-lane.jpg) |
| ![Cooper Straight below the garages](docs/screenshots/brands-cooper-straight.jpg) | ![Clearways to Clark Curve](docs/screenshots/brands-clearways.jpg) |
| ![Pit straight from above](docs/screenshots/brands-pit-straight-aerial.jpg) | |

### Lap timing

Cross the start/finish line to start a lap. The HUD shows the lap time, three sector splits (purple = personal best), and your best and last lap.

A lap only counts if you actually drove it forwards. Straying more than 45 m from the circuit invalidates it.

### Practice opponent

Press **O** to add an AI car to race against (O again removes it). It drives the same car you're in, in blue, and starts just ahead of you on the other side of the track (or before the start line if you're off the circuit). **K** cycles its skill: Rookie, Club, Pro, Alien. The choice is remembered. Switching car with [ / ] puts the opponent in the new car too.

Under your lap timer the HUD shows whether it's ahead or behind and by roughly how many seconds, plus its best and last lap. It's the blue dot on the track map. Cars collide, so you can rub and bump.

How it drives (`src/game/BotDriver.js`):
- **Racing line:** a minimum-curvature line inside the kerbs, computed when it's added.
- **Speed plan:** corner speeds from that line's curvature at the skill's share of the car's grip, with braking and acceleration zones.
- **Driving:** path-tracking steering (curvature feed-forward plus heading and cross-track error), countersteer in slides, gentle throttle lifts, and a throttle-on slide catch in front-drivers.
- **Traffic:** it moves over to pass you on the side with more room, and follows if there's no room.
- **Learning:** a big slide or running wide makes it slower into that corner next time, and trims its trust in the car's grip; clean running slowly restores it.
- **Recovery:** if it rolls, gets stuck or ends up far off the line, it resets itself onto the line.

Each car starts from an offline calibration of how much grip the bot can really use on each circuit (`src/game/botCalibration.js`, built by `tools/bot-calibrate.mjs` and refined by `tools/bot-grip-search.mjs`). After changing a car's handling, re-check with:

```bash
node tools/bot-test.mjs brands "GT3" 2
```

### Adding a circuit from a layout diagram

```bash
python3 tools/extract-track.py tools/reference/brands-hatch.json
```

The config gives:
- the diagram image (the track drawn as a single red, blue or black line);
- a pixel on the track and the racing direction;
- the start-line pixel;
- the official lap length (sets the scale);
- the rotation to true north;
- named corner pixels;
- optionally `fair`: `[[fromIdx, toIdx], ...]` stretches of the output to replace with the smoothest joining curve, for places where arrows, flags or labels distort the diagram's line.

The output is an ES module of evenly spaced centreline points. Then copy `src/world/maps/brandsHatch.js` as a template and register the new map in `src/world/maps/index.js`.

To check that a map is drivable, run the headless AI driver:

```bash
npm run lap -- brands GT3
```

It reports barrier contacts, time off track and lap times. The AI is deliberately simple: it follows the centreline at about 85% grip, so its times are slower than a human on the racing line.

## Test environment

| Area | What it's for |
|---|---|
| **Start pad + skidpad** | Flat asphalt with a 30 m radius skidpad (steady-state cornering), 25 m distance marks for launch and braking, slalom cones, and suspension speed bumps. |
| **Surface strips** | Eight side-by-side 260 m strips to compare traction: concrete, wet asphalt, gravel, dirt, grass, sand, snow and ice. Each is labelled with its μ. |
| **Jump park** | • Lane 1: three tabletops (1 m, 2.2 m, 3 m).<br>• Lane 2: whoops/rollers, then a step-up.<br>• Lane 3: a 4 m kicker over a ~40 m **gap** (needs ~85 km/h).<br>• Lane 4: an off-camber side slope and a speed bump. |
| **Circuit** | 2.2 km closed loop with elevation change (+14 m), banked sweepers, kerbs (bumpy and lower grip), run-off, and gravel traps on the outside of tight corners. |
| **Walled section** | A ~570 m street-circuit stretch through the twisty north part of the circuit. Red/white concrete walls 2.6 m outside the track edge on both sides, with debris fencing, and wall ends that flare away so there's no blunt end to hit. Spawn key **8**. |
| **Hills** | Rolling off-road terrain with dirt patches and snow at altitude. Mountains bound the world. |

## Architecture

```
src/
  physics/            engine-agnostic core
    math.js           Vec3 / Quat / helpers
    RigidBody.js      6-DOF body, diagonal inertia, impulses
    Tire.js           Pacejka combined-slip tyre + relaxation + load sensitivity + camber + temperature
    Powertrain.js     Engine, clutch, gearbox, open/LSD/locked differentials (velocity-level solve)
    Vehicle.js        Suspension, steering, aero, brakes, ABS/TCS/ESC, auto gearbox, hull collisions
  vehicles/presets.js twelve vehicles, all data (see docs/VEHICLE_PROPERTIES.md)
  world/              heightfield + analytic ramps, surfaces, track spline, walls
    maps/             map definitions (test.js documents every hook; brandsHatch.js; index.js registry)
  game/LapTimer.js    lap / sector timing
  render/             Three.js views (world, car, particles/skids, cameras)
  input/              keyboard + Gamepad API, bindings, curves, rumble
  ui/                 HUD, telemetry, calibration screen, tuning panel
  audio/              procedural engine/tyre/wind audio
docs/VEHICLE_PROPERTIES.md   full property specification
tools/                static server and headless physics regression
```

### Using the physics in your own game

```js
import { Vehicle } from './physics/Vehicle.js';
import { makeVehicle } from './vehicles/presets.js';

// your world only needs one query: ground height, normal and surface at (x, z)
const world = { sample(x, z, out) { out.height = ...; out.normal.set(...); out.surface = SURFACES[id]; return out; } };

const car = new Vehicle(makeVehicle({ body: { mass: 1300 }, drivetrain: { layout: 'AWD' } }), world);
car.reset(spawnPos, yaw);
// every fixed tick (600 Hz recommended):
car.setInput({ steer, throttle, brake, handbrake, clutch });
car.step(1 / 600);
// render from car.body (position/orientation) and car.wheels[i] (compression, steer, rotation, contactPoint)
```

### Physics notes

- **Fixed 600 Hz step.** Tyres and suspension are stiff, so the step is small; a frame does about 8–10 steps and costs ~1 ms in JS.
- **Tyres:**
  - Normalised Magic Formula curves (peak at slip = 1) with combined slip via slip similarity (friction ellipse).
  - Slip states use relaxation lengths integrated implicitly. That stabilises low speed and lets a parked car hold on a slope.
  - Load sensitivity, camber thrust and a thermal model are included.
- **Drivetrain:**
  - The clutch and differentials are solved as torque-limited velocity constraints: they lock when they can and slip when the torque exceeds their capacity. That keeps a locked diff or engaged clutch stable at any gear ratio.
  - LSD = preload + power/coast ramp.
- **Suspension:**
  - Ray per wheel with Newton refinement on sloped ground.
  - Progressive bump stops, digressive (fast-bump) damping and anti-roll bars.
  - Anti-squat/anti-dive and roll-centre height are modelled by where the tyre forces are applied.
- **Hull:** collision points with impulse contacts and friction, for landings, scraping and rollovers.
- **Walls:**
  - Vertical slabs whose base follows the terrain, stored in a 10 m spatial grid, so each car only checks the few segments near it.
  - Each car has a ring of contact points at bumper and door height (every ~0.5 m), plus points on each wheel's outer face, so open-wheelers hit with their tyres.
  - Contacts resolve with a normal impulse (restitution only on hard hits), scrape friction and a position correction that adds no energy.
  - At 600 Hz a car would need over 180 m/s to tunnel through a 0.6 m wall.
  - Cars expose `wallContact` (point, normal, impact and scrape speed), which drives sparks, scrape audio, rumble, and losing the drift combo.
- **Assists:**
  - ABS: pressure ceiling plus slip-based release.
  - TCS: a P+I controller on engine torque.
  - ESC: per-wheel yaw-error braking.
  - Speed-sensitive lock limited to "geometric angle at max lateral g + peak slip angle".

Reference numbers from `npm run test:physics` (flat asphalt):

| Car | 0–100 km/h | Braking | Lateral |
|---|---|---|---|
| GT Coupe | 6.0 s | 1.0 g | 0.96 g |
| Rally AWD | 3.6 s | 1.0 g | 0.89 g |
| Track Prototype | 3.3 s | 1.8 g (downforce) | 1.7 g |
| '67 Lotus GP | 4.2 s (297 km/h top speed) | ~1.0–1.2 g (no ABS) | 1.0 g; four-wheel drifts when provoked |
| '64 Works Mini | 9.6 s (164 km/h top speed) | 0.65 g (no ABS) | 0.78 g; strong lift-off oversteer |
| Drift Car | 6.4 s (wheelspin-limited, TC off) | 1.0 g | holds 30° drifts; see below |
| GT3 | 3.4 s (295 km/h top speed) | 2.2 g peak | 1.5 g at 120, 1.7 g at 200 km/h |
| Formula 1 | 3.4 s (0–200: 8.0 s) | 4.75 g peak from 324 km/h top speed | 3.3 g at 220 km/h |
| Kart | 112 km/h top speed | 0.7 g (rear-only brakes) | 1.35 g at 80 km/h |

**Drift car tuning:**
- **Steering:** 60° angle kit, with only light speed-sensitive lock so you can countersteer at speed. Stronger countersteer assist for pads.
- **Diff and handbrake:** 2-way LSD at 90% power lock / 75% coast lock. 5,500 Nm hydraulic handbrake that also pulls the clutch.
- **Tyres:** grippier fronts than rears, and a flat rear curve past peak so a slide stays progressive rather than snapping.

An automated driver (countersteer plus throttle-on-angle) holds 30° drifts in this car. The same driver spins the GT coupe, muscle car and GT3 within about a second.

### Extending

- **New car:** add `makeVehicle({...overrides})` to `PRESETS`. The visual is generated from its dimensions and `style` (`coupe`, `hatch`, `proto`, `truck`, `gt3` for a wide-body racer with wing, `drift` for a drift build, `mini` for a '60s works Mini (supports `roofColor` and `raceNumber`), `cigar` for a '60s cigar-bodied GP car, `f1` for an open-wheeler, or `kart`). An optional `view.hood: [y, z]` sets a custom cockpit camera.
- **New surface:** add a row to `src/world/Surfaces.js`.
- **New ramp or obstacle:** add a prop in `makeProps()` in `World.js`. It's exact analytic geometry, rendered automatically.
- **New wall:** call `world.addWall([[x, z], ...], { height, thickness, style })` with any polyline. Physics, rendering and camera avoidance pick it up automatically.
- **Live tuning:** tune live in the Tab panel, then **Export JSON** to paste into a preset.

## Known limits / next steps

- No car-to-car collision yet. Walls are vertical slabs only: no Armco deformation, tyre barriers or damage.
- Wheels are single rays, not shape casts, so sharp vertical edges can be "climbed".
- The Gamepad API has no wheel force feedback in browsers (rumble only). The inputs a force-feedback layer needs are already exposed per wheel for a native port: front lateral force, slip and impacts. Self-aligning torque ≈ Fy × pneumatic trail.
- No damage, fuel or tyre wear yet. These are marked **[hook]** in the property spec.

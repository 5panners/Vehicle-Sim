# Vehicle Property Specification

Every vehicle in the sim is a single data object (see `src/vehicles/presets.js`).
This document lists every property, its unit, typical range, and what it does to
the handling. Properties marked **[impl]** are simulated today; **[hook]** are
present in the data model and ready for a game to build on.

Coordinate system (body space): **+X right, +Y up, +Z forward**. SI units throughout
(m, kg, s, N, Nm, rad) unless stated. RPM and km/h are used only for authoring.

---

## 1. Chassis / Body

| Property | Unit | Typical | Effect |
|---|---|---|---|
| `mass` | kg | 900–2500 | Total mass incl. driver/fuel. **[impl]** |
| `cgHeight` | m | 0.35–0.7 | Centre of gravity height above ground at rest. Higher = more weight transfer, more body roll, rollover risk. **[impl]** |
| `weightDistFront` | 0–1 | 0.40–0.62 | Static front axle share. Drives under/oversteer balance. **[impl]** (sets CG z) |
| `inertiaScale` | xyz | ~1 | Multiplier on box-derived inertia tensor (yaw/pitch/roll). Low yaw inertia = snappier rotation. **[impl]** |
| `dimensions` | m | w 1.8, h 1.3, l 4.4 | Body box used for inertia, collision and visuals. **[impl]** |
| `wheelbase` | m | 2.4–3.0 | Distance front→rear axle. **[impl]** |
| `trackFront` / `trackRear` | m | 1.5–1.7 | Lateral wheel spacing. Wider = less weight transfer. **[impl]** |
| `collisionPoints` | — | box corners | Hull contact points for landing, rollover, scraping. **[impl]** |
| `groundClearance` | m | 0.06–0.3 | Hull bottom height above ground at rest (proto 0.06 beaches on whoops, truck 0.3 doesn't). **[impl]** |
| `color`, `style` | — | `coupe`/`hatch`/`proto`/`truck` | Placeholder visual generated from dimensions. **[impl]** |
| `bodyFriction` | — | 0.5 | Friction coefficient of the hull sliding on ground. **[impl]** |
| `fuelMass`, `fuelCapacity` | kg / L | — | Mass that changes over a race. **[hook]** |
| `damageModel` | — | — | Deformation/damage thresholds. **[hook]** |

## 2. Suspension (per axle)

| Property | Unit | Typical | Effect |
|---|---|---|---|
| `springRate` | N/m | 25k–120k | Wheel-rate stiffness. Stiffer = quicker response, less grip over bumps. **[impl]** |
| `bumpDamping` / `reboundDamping` | Ns/m | 2k–8k | Damper force in compression / extension. Controls weight-transfer *rate* and landing behaviour. **[impl]** |
| `fastBumpThreshold` / `fastBumpFactor` | m/s / — | 0.25 / 0.5 | Digressive damping above a shaft speed (absorbs kerbs, jumps). **[impl]** |
| `restLength` | m | 0.3–0.5 | Spring free length (sets ride height). **[impl]** |
| `travel` | m | 0.12–0.35 | Usable stroke before bump stop. **[impl]** |
| `bumpStopRate` | N/m | 5–10× spring | Progressive stop at full compression (hard landings). **[impl]** |
| `antiRollBar` | N/m | 0–60k | Couples left/right compression. Front stiffer → understeer, rear stiffer → oversteer. **[impl]** |
| `rideHeightOffset` | m | ±0.05 | Static preload/height trim. **[impl]** |
| `camber` | deg | −4…0 | Static camber; gives camber-thrust and changes peak lateral grip with roll. **[impl]** |
| `camberGain` | deg/m | 0–30 | Camber change with compression (approximates geometry). **[impl]** |
| `toe` | deg | −0.5…+0.5 | Toe-in stabilises, toe-out sharpens turn-in. **[impl]** |
| `caster` | deg | 3–8 | Self-aligning torque scaling for force feedback. **[hook]** (used for FFB strength) |
| `steerJacking` | m/rad | 0 (cars) – 0.07 (kart) | Caster/KPI geometry: steering pushes the inside front wheel down, lifting the inside rear through the frame. Lets a solid-axle kart turn. **[impl]** |
| `antiSquat` / `antiDive` | 0–1 | 0–0.5 | Fraction of longitudinal load transfer taken through links instead of springs. **[impl]** |
| `rollCenterHeight` | m | 0–0.15 | Fraction of lateral load taken geometrically. **[impl]** (as `antiRoll geometric` share) |

## 3. Wheels & Tyres

| Property | Unit | Typical | Effect |
|---|---|---|---|
| `radius` | m | 0.30–0.40 | Rolling radius. Affects effective gearing. **[impl]** |
| `width` | m | 0.2–0.33 | Visual + contact patch width (grip scale). **[impl]** |
| `wheelInertia` | kg·m² | 0.8–2.0 | Spin inertia incl. brake disc. Affects wheelspin response, lock-up. **[impl]** |
| `tire.peakFrictionX` / `peakFrictionY` | μ | 0.9–1.6 | Peak longitudinal / lateral friction on reference surface. **[impl]** |
| `tire.peakSlipRatio` | — | 0.08–0.15 | Slip ratio of peak Fx. **[impl]** |
| `tire.peakSlipAngle` | deg | 5–10 | Slip angle of peak Fy. **[impl]** |
| `tire.B`, `C`, `E` (per axis) | — | C≈1.65 (x), 1.3 (y) | Pacejka Magic Formula shape: C = shape, E = curvature (fall-off after peak). **[impl]** |
| `tire.loadSensitivity` | — | 0.05–0.15 | μ drop as load rises above nominal; key to realistic weight transfer effect. **[impl]** |
| `tire.nominalLoad` | N | ~4000 | Reference load for the curves. **[impl]** |
| `tire.relaxationLengthX/Y` | m | 0.1–0.6 | Transient build-up of force; stabilises low speed, gives "tyre carcass" feel. **[impl]** |
| `tire.rollingResistance` | — | 0.010–0.015 | Rolling resistance coefficient. **[impl]** |
| `tire.camberStiffness` | — | 0.05–0.2 | Lateral force per rad of camber (camber thrust). **[impl]** |
| `tire.optimalTemp`, `tempWindow` | °C | 85 / 30 | Grip vs. temperature. **[impl]** (simple thermal model) |
| `tire.heatRate`, `coolRate` | — | — | How fast slip energy heats the tyre. **[impl]** |
| `tire.wearRate` | — | — | Grip loss over distance/slip energy. **[hook]** |
| `tire.pressure` | kPa | — | Would scale stiffness/peak; for tuning menus. **[hook]** |

## 4. Engine

| Property | Unit | Typical | Effect |
|---|---|---|---|
| `torqueCurve` | [rpm, Nm][] | — | Full-throttle torque table, interpolated. **[impl]** |
| `idleRPM` / `redlineRPM` / `limiterRPM` | rpm | 900 / 7500 / 7800 | Operating range. **[impl]** |
| `limiterCutTime` | s | 0.05 | Fuel-cut duration when bouncing off the limiter. **[impl]** |
| `engineInertia` | kg·m² | 0.1–0.3 | Flywheel + crank. Low = revs climb/drop quickly. **[impl]** |
| `engineBrakingTorque` | Nm | 30–80 | Friction/pumping torque closed-throttle (scales with rpm). **[impl]** |
| `throttleResponse` | 1/s | 8–20 | Throttle body lag. **[impl]** |
| `turbo.boost` / `turbo.spoolRate` | — | — | Optional boost multiplier with lag. **[impl]** |
| `fuelConsumption` | — | — | **[hook]** |

## 5. Transmission & Clutch

| Property | Unit | Typical | Effect |
|---|---|---|---|
| `gearRatios` | — | [3.4 … 0.8] | Forward ratios. **[impl]** |
| `reverseRatio` | — | −3.2 | **[impl]** |
| `finalDrive` | — | 3.0–4.5 | Diff ratio. **[impl]** |
| `shiftTime` | s | 0.05–0.4 | Torque interruption during a shift. **[impl]** |
| `clutchMaxTorque` | Nm | 1.3–2× peak engine | Clutch capacity — it can slip if exceeded. **[impl]** |
| `clutchEngageRPM` / `clutchFullRPM` | rpm | idle+150 / +1400 | Auto-clutch bite and full-lock points. Set high to model a centrifugal clutch (kart: 5500 / 7500). **[impl]** |
| `autoShiftUpRPM` / `autoShiftDownRPM` | rpm | — | Automatic gearbox thresholds. **[impl]** |
| `drivetrainEfficiency` | 0–1 | 0.85–0.92 | Losses to the wheels. **[impl]** |
| `type` | enum | `manual`/`auto` | Player-selectable; manual clutch supported on a controller axis. **[impl]** |

## 6. Differentials & Drive Layout

| Property | Unit | Typical | Effect |
|---|---|---|---|
| `driveLayout` | enum | `RWD`/`FWD`/`AWD` | Which axles get torque. **[impl]** |
| `centerSplitFront` | 0–1 | 0.3–0.5 (AWD) | Front torque share for AWD. **[impl]** |
| `diff.type` (front/rear/center) | enum | `open`/`locked`/`lsd` | **[impl]** |
| `diff.preload` | Nm | 50–200 | LSD base locking torque. **[impl]** |
| `diff.powerLock` / `coastLock` | 0–1 | 0.2–0.8 / 0.1–0.5 | Clutch-type LSD ramp: locking on throttle / off throttle. More power lock → stable exits but more power-understeer/oversteer. **[impl]** |

## 7. Brakes

| Property | Unit | Typical | Effect |
|---|---|---|---|
| `maxBrakeTorque` | Nm | 2000–5000 | Total brake torque at full pedal. **[impl]** |
| `brakeBias` | 0–1 | 0.55–0.70 | Front share. Too high → understeer under braking; too low → spin. **[impl]** |
| `handbrakeTorque` | Nm | 1500–4000 | Rear-only, for drifts/hairpins. **[impl]** |
| `brakeFade` | — | — | **[hook]** |

## 8. Steering

| Property | Unit | Typical | Effect |
|---|---|---|---|
| `maxSteerAngle` | deg | 30–40 | Max road-wheel lock. **[impl]** |
| `ackermann` | 0–1 | 0.5–1 | Inner wheel turns more. **[impl]** |
| `steerSpeed` | 1/s | 3–8 | How fast the wheel can be turned (digital/pad smoothing). **[impl]** |
| `speedSensitivity` | — | 0–1 | Pad/keyboard assist: blends full lock → the *useful* lock at speed (geometric angle for max lateral g + peak slip angle). Bypassed in Wheel steering mode. **[impl]** |
| `countersteerAssist` | 0–1 | — | Nudges steering toward drift direction (gamepad assist). **[impl]** |

## 9. Aerodynamics

| Property | Unit | Typical | Effect |
|---|---|---|---|
| `dragCoefficient` (Cd) | — | 0.28–0.45 | **[impl]** |
| `frontalArea` | m² | 1.8–2.6 | **[impl]** |
| `liftCoefFront` / `liftCoefRear` | — | −1.5…+0.1 | Negative = downforce, applied at each axle (affects balance at speed). **[impl]** |
| `airDensity` | kg/m³ | 1.225 | World property. **[impl]** |
| `angularDrag` | — | — | Rotational air damping, keeps airborne car stable. **[impl]** |

## 10. Driver Assists

| Property | Effect |
|---|---|
| `abs` | Modulates brake torque per wheel to hold peak slip. **[impl]** |
| `tcs` | Cuts throttle when driven wheel slip exceeds target. **[impl]** |
| `stability` (ESC) | Brakes individual wheels to stop yaw rate exceeding the expected yaw. **[impl]** |
| `autoClutch`, `autoGearbox` | **[impl]** |
| `steeringAssist` | speed-sensitive lock + countersteer. **[impl]** |

## 11. Surfaces (world property, per material)

| Property | Effect |
|---|---|
| `friction` | μ multiplier vs. tyre's reference (asphalt 1.0, ice ~0.12). |
| `peakSlipScale` | Loose surfaces peak at higher slip. |
| `falloff` | Loose surfaces keep grip past peak (higher), asphalt drops off. |
| `rollingDrag` | Extra resistance (sand, grass, deep gravel). |
| `bumpiness` / `bumpScale` | Procedural micro-bumps fed into suspension. |
| `color`, `particles` | Visual dust/smoke. |

## 12. Force feedback / rumble (output)

Per-wheel slip, tyre forces (Fx/Fy), suspension compression velocity and
bump-stop hits are exposed on the vehicle (`vehicle.wheels[i]`, `vehicle.telemetry`).
The demo maps them to Gamepad dual-rumble **[impl]**. A wheel FFB layer would
derive self-aligning torque from front Fy × pneumatic trail (scaled by caster) **[hook]**.

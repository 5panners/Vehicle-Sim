// Vehicle definitions. Every number here is documented in docs/VEHICLE_PROPERTIES.md.
// New vehicles: start from BASE via makeVehicle(overrides) and change what differs.

export function deepMerge(base, over) {
  if (over === undefined) return structuredClone(base);
  if (Array.isArray(over) || typeof over !== 'object' || over === null) return structuredClone(over);
  const out = structuredClone(base ?? {});
  for (const k of Object.keys(over)) out[k] = deepMerge(base?.[k], over[k]);
  return out;
}

const TIRE_STREET = {
  peakFrictionX: 1.10, peakFrictionY: 1.05,
  peakSlipRatio: 0.10, peakSlipAngle: 7.5,
  shapeX: { C: 1.6, E: 0.2 }, shapeY: { C: 1.35, E: 0.1 },
  loadSensitivity: 0.10, nominalLoad: 4000,
  relaxationLengthX: 0.22, relaxationLengthY: 0.38,
  rollingResistance: 0.012, camberStiffness: 0.6,
  optimalTemp: 85, tempWindow: 35, heatRate: 3, coolRate: 0.02,
};

const AXLE_SUSP = {
  springRate: 55000, bumpDamping: 3200, reboundDamping: 5200,
  fastBumpThreshold: 0.3, fastBumpFactor: 0.4,
  restLength: 0.30, travel: 0.16, bumpStopRate: 300000, rideHeightOffset: 0,
  antiRollBar: 25000, camber: -1.5, camberGain: 10, toe: 0, caster: 6, rollCenterHeight: 0.06,
};

export const BASE = {
  name: 'Base', description: '', color: 0xcc2222, style: 'coupe',
  body: {
    mass: 1450, cgHeight: 0.48, weightDistFront: 0.52, groundClearance: 0.12,
    dimensions: { width: 1.9, height: 1.25, length: 4.5 },
    inertiaScale: { x: 0.9, y: 0.85, z: 0.9 }, bodyFriction: 0.45,
  },
  geometry: { wheelbase: 2.65, trackFront: 1.6, trackRear: 1.6 },
  suspension: {
    front: { ...AXLE_SUSP, springRate: 60000, antiRollBar: 30000, camber: -2 },
    rear: { ...AXLE_SUSP, toe: 0.2 },
    antiDive: 0.2, antiSquat: 0.25,
  },
  wheels: { front: { radius: 0.34, width: 0.255, inertia: 1.2 }, rear: { radius: 0.34, width: 0.285, inertia: 1.3 } },
  tires: { front: { ...TIRE_STREET }, rear: { ...TIRE_STREET } },
  engine: {
    torqueCurve: [[800, 300], [2000, 420], [3500, 500], [5000, 530], [6500, 500], [7500, 440], [8000, 380]],
    idleRPM: 850, redlineRPM: 7500, limiterRPM: 7700, limiterCutTime: 0.06,
    inertia: 0.18, engineBrakingTorque: 60, throttleResponse: 15,
    turbo: { maxBoost: 0, spoolRate: 3 }, cylinders: 8,
  },
  transmission: {
    gearRatios: [3.2, 2.2, 1.65, 1.3, 1.05, 0.86], reverseRatio: -3.0, finalDrive: 3.5,
    shiftTime: 0.15, clutchMaxTorque: 900, efficiency: 0.9,
    autoShiftUpRPM: 7200, autoShiftDownRPM: 3600,
  },
  drivetrain: {
    layout: 'RWD', centerSplitFront: 0.4,
    frontDiff: { type: 'open', preload: 0, powerLock: 0, coastLock: 0 },
    rearDiff: { type: 'lsd', preload: 80, powerLock: 0.45, coastLock: 0.25 },
    centerDiff: { type: 'lsd', preload: 100, powerLock: 0.5, coastLock: 0.3 },
  },
  brakes: { maxTorque: 6000, bias: 0.62, handbrakeTorque: 3000 },
  steering: { maxAngle: 32, ackermann: 0.6, steerSpeed: 4.0, speedSensitivity: 0.9, countersteerAssist: 0.25 },
  aero: { dragCoefficient: 0.33, frontalArea: 2.0, liftCoefFront: -0.15, liftCoefRear: -0.25, angularDrag: 0.3, airDensity: 1.225 },
  assists: { abs: true, tcs: true, stability: false, autoGearbox: true, autoClutch: true },
};

export const makeVehicle = (over) => deepMerge(BASE, over);

export const PRESETS = [
  makeVehicle({
    name: 'GT Coupe', description: 'Front-engine RWD sports car, ~450 hp, clutch-type LSD. Balanced, drifts on demand.',
  }),
  makeVehicle({
    name: 'Muscle Car', description: 'Heavy V8 RWD with soft springs and a lazy LSD. Big torque, loves to slide.',
    color: 0xffaa00, style: 'coupe',
    body: { mass: 1720, cgHeight: 0.52, weightDistFront: 0.55, dimensions: { width: 1.95, height: 1.32, length: 4.8 }, inertiaScale: { y: 0.9 } },
    geometry: { wheelbase: 2.85, trackFront: 1.6, trackRear: 1.62 },
    suspension: { front: { springRate: 45000, antiRollBar: 26000, bumpDamping: 2800, reboundDamping: 4200 }, rear: { springRate: 40000, antiRollBar: 10000, bumpDamping: 2800, reboundDamping: 4200, camber: -0.5 } },
    tires: { front: { peakFrictionY: 0.98 }, rear: { peakFrictionX: 1.05, peakFrictionY: 1.0 } },
    engine: {
      torqueCurve: [[700, 420], [2000, 600], [3500, 680], [4800, 660], [5800, 590], [6400, 520], [6800, 470]],
      idleRPM: 700, redlineRPM: 6400, limiterRPM: 6600, inertia: 0.26, engineBrakingTorque: 80, cylinders: 8,
    },
    transmission: { gearRatios: [2.66, 1.78, 1.3, 1.0, 0.8, 0.63], finalDrive: 3.73, clutchMaxTorque: 1100, autoShiftUpRPM: 6100, autoShiftDownRPM: 2800 },
    drivetrain: { rearDiff: { type: 'lsd', preload: 50, powerLock: 0.25, coastLock: 0.1 } },
    brakes: { maxTorque: 6200, bias: 0.6 },
    aero: { dragCoefficient: 0.38, frontalArea: 2.2, liftCoefFront: 0.05, liftCoefRear: 0.05 },
  }),
  makeVehicle({
    name: 'Track Prototype', description: 'Light, stiff, high-downforce racer with slick tyres. Grip rises with speed.',
    color: 0xe8e8e6, accent: 0xe85d04, style: 'proto',
    // glTF body built in Blender (tools/blender/build_sp300r.py): a Caterham SP/300.R-style Le Mans roadster
    model: { url: 'assets/models/sp300r.glb', prefix: 'SP_', brakeMaterial: 'SP_Taillight' },
    view: { hood: [0.84, -0.3] },
    body: { mass: 980, cgHeight: 0.32, weightDistFront: 0.44, groundClearance: 0.06, dimensions: { width: 1.95, height: 1.0, length: 4.6 }, inertiaScale: { y: 0.75 } },
    geometry: { wheelbase: 2.75, trackFront: 1.65, trackRear: 1.6 },
    suspension: {
      front: { springRate: 120000, bumpDamping: 5500, reboundDamping: 8000, restLength: 0.18, travel: 0.07, antiRollBar: 50000, camber: -3, rollCenterHeight: 0.03 },
      rear: { springRate: 140000, bumpDamping: 6000, reboundDamping: 8500, restLength: 0.18, travel: 0.07, antiRollBar: 40000, camber: -2, toe: 0.15, rollCenterHeight: 0.05 },
    },
    wheels: { front: { radius: 0.33, width: 0.3, inertia: 1.0 }, rear: { radius: 0.34, width: 0.35, inertia: 1.15 } },
    tires: {
      front: { peakFrictionX: 1.5, peakFrictionY: 1.55, peakSlipRatio: 0.08, peakSlipAngle: 6, shapeY: { C: 1.45, E: -0.2 }, optimalTemp: 95, relaxationLengthY: 0.3 },
      rear: { peakFrictionX: 1.55, peakFrictionY: 1.55, peakSlipRatio: 0.08, peakSlipAngle: 6, shapeY: { C: 1.45, E: -0.2 }, optimalTemp: 95, relaxationLengthY: 0.3 },
    },
    engine: {
      torqueCurve: [[1500, 250], [3000, 380], [5000, 450], [7000, 470], [8500, 440], [9200, 400], [9500, 360]],
      idleRPM: 1500, redlineRPM: 9200, limiterRPM: 9400, inertia: 0.1, engineBrakingTorque: 50, cylinders: 6,
    },
    transmission: { gearRatios: [2.8, 2.1, 1.7, 1.4, 1.18, 1.0], finalDrive: 3.4, shiftTime: 0.05, clutchMaxTorque: 800, autoShiftUpRPM: 9000, autoShiftDownRPM: 5000 },
    brakes: { maxTorque: 6500, bias: 0.58, handbrakeTorque: 2000 },
    aero: { dragCoefficient: 0.45, frontalArea: 1.6, liftCoefFront: -1.4, liftCoefRear: -2.0 },
  }),
  makeVehicle({
    name: "'67 Lotus GP", description: "Inspired by the 1967 Lotus 49: cigar monocoque, 3.0 Cosworth-style V8 as a stressed member (~400 hp, peaky), no wings, skinny period tyres, 560 kg with driver. No assists. Power oversteer on demand; drive it on the throttle.",
    color: 0x0b5d34, accent: 0xffd400, style: 'cigar', raceNumber: '5',
    view: { hood: [0.56, -0.04] }, // driver's eye: 60s drivers sat high, eyes above the screen
    body: {
      mass: 560, cgHeight: 0.3, weightDistFront: 0.4, groundClearance: 0.08,
      dimensions: { width: 1.75, height: 0.85, length: 3.95 },
      inertiaScale: { x: 0.65, y: 0.72, z: 0.65 }, bodyFriction: 0.35, // fuel in the side tanks adds yaw inertia
    },
    geometry: { wheelbase: 2.42, trackFront: 1.53, trackRear: 1.55 },
    suspension: {
      front: { springRate: 35000, bumpDamping: 1300, reboundDamping: 2000, fastBumpThreshold: 0.2, fastBumpFactor: 0.45, restLength: 0.15, travel: 0.08, bumpStopRate: 250000, antiRollBar: 20000, camber: -1, camberGain: 15, toe: 0, caster: 5, rollCenterHeight: 0.03 },
      rear: { springRate: 45000, bumpDamping: 1800, reboundDamping: 2700, fastBumpThreshold: 0.2, fastBumpFactor: 0.45, restLength: 0.15, travel: 0.08, bumpStopRate: 250000, antiRollBar: 3000, camber: -0.5, camberGain: 12, toe: 0.2, rollCenterHeight: 0.1 },
      antiDive: 0.1, antiSquat: 0.2,
    },
    wheels: { front: { radius: 0.29, width: 0.16, inertia: 0.6 }, rear: { radius: 0.32, width: 0.25, inertia: 0.9 } },
    // 1967 racing tyres: decent peak, gentle fall-off -> the classic four-wheel drift
    tires: {
      front: { peakFrictionX: 1.15, peakFrictionY: 1.2, peakSlipRatio: 0.11, peakSlipAngle: 7.5, shapeY: { C: 1.3, E: 0.2 }, loadSensitivity: 0.1, nominalLoad: 1300, relaxationLengthX: 0.25, relaxationLengthY: 0.45, optimalTemp: 75, tempWindow: 35, heatRate: 3 },
      rear: { peakFrictionX: 1.25, peakFrictionY: 1.2, peakSlipRatio: 0.12, peakSlipAngle: 7.5, shapeX: { C: 1.45, E: 0.3 }, shapeY: { C: 1.3, E: 0.2 }, loadSensitivity: 0.1, nominalLoad: 1800, relaxationLengthX: 0.25, relaxationLengthY: 0.45, optimalTemp: 75, tempWindow: 35, heatRate: 3 },
    },
    engine: {
      // famously peaky: the power arrives in a rush around 6500 rpm
      torqueCurve: [[3000, 170], [5000, 215], [6000, 240], [6500, 285], [8000, 315], [9000, 310], [9500, 290], [10000, 255]],
      idleRPM: 3000, redlineRPM: 9500, limiterRPM: 10000, limiterCutTime: 0.06,
      inertia: 0.07, engineBrakingTorque: 50, throttleResponse: 18, cylinders: 8,
    },
    transmission: { gearRatios: [2.5, 1.85, 1.45, 1.18, 1.0], reverseRatio: -2.8, finalDrive: 3.9, shiftTime: 0.15, clutchMaxTorque: 500, efficiency: 0.92, autoShiftUpRPM: 9300, autoShiftDownRPM: 6500 },
    drivetrain: { layout: 'RWD', rearDiff: { type: 'lsd', preload: 40, powerLock: 0.4, coastLock: 0.2 } },
    brakes: { maxTorque: 3200, bias: 0.6, handbrakeTorque: 500 },
    steering: { maxAngle: 20, ackermann: 0.5, steerSpeed: 4.5, speedSensitivity: 0.85, countersteerAssist: 0.25 },
    aero: { dragCoefficient: 0.6, frontalArea: 1.1, liftCoefFront: 0.05, liftCoefRear: 0.1, angularDrag: 0.3 },
    // period cars had no TC; it's on by default so keyboard/pad players can drive it. Switch it off for the real thing.
    assists: { abs: false, tcs: true, stability: false },
  }),
  makeVehicle({
    name: 'Caterham 620R', description: 'Lightweight track-day roadster: 620 kg with driver, 310 hp supercharged 2.0 (peaky, revs to 8,000), 6-speed manual, RWD with a limited-slip diff, semi-slicks, no aero and no assists. 0-60 in under 3 seconds and it never stops talking to you; be smooth with the throttle.',
    color: 0x0f3b22, accent: 0xe8a91f, style: 'cigar',
    // glTF body built in Blender (tools/blender/build_caterham_620r.py)
    model: { url: 'assets/models/caterham-620r.glb', prefix: 'CAT_', brakeMaterial: 'CAT_Taillight' },
    view: { hood: [0.98, -0.6] },
    body: {
      mass: 620, cgHeight: 0.3, weightDistFront: 0.48, groundClearance: 0.1,
      dimensions: { width: 1.7, height: 1.1, length: 3.1 },
      inertiaScale: { x: 0.6, y: 0.7, z: 0.6 }, bodyFriction: 0.35,
    },
    geometry: { wheelbase: 2.4, trackFront: 1.24, trackRear: 1.28 },
    suspension: {
      front: { springRate: 48000, bumpDamping: 1800, reboundDamping: 2800, fastBumpThreshold: 0.2, fastBumpFactor: 0.45, restLength: 0.16, travel: 0.08, bumpStopRate: 250000, antiRollBar: 12000, camber: -1.5, camberGain: 12, toe: 0, caster: 6, rollCenterHeight: 0.04 },
      rear: { springRate: 58000, bumpDamping: 2100, reboundDamping: 3200, fastBumpThreshold: 0.2, fastBumpFactor: 0.45, restLength: 0.16, travel: 0.08, bumpStopRate: 250000, antiRollBar: 5000, camber: -1.0, camberGain: 10, toe: 0.1, rollCenterHeight: 0.1 },
      antiDive: 0.1, antiSquat: 0.2,
    },
    wheels: { front: { radius: 0.285, width: 0.205, inertia: 0.5 }, rear: { radius: 0.3, width: 0.26, inertia: 0.7 } },
    tires: {
      front: { peakFrictionX: 1.3, peakFrictionY: 1.38, peakSlipRatio: 0.09, peakSlipAngle: 6.5, shapeY: { C: 1.4, E: 0.0 }, loadSensitivity: 0.1, nominalLoad: 1450, relaxationLengthX: 0.22, relaxationLengthY: 0.36, optimalTemp: 80, tempWindow: 32, heatRate: 3 },
      rear: { peakFrictionX: 1.38, peakFrictionY: 1.38, peakSlipRatio: 0.09, peakSlipAngle: 6.5, shapeY: { C: 1.4, E: 0.0 }, loadSensitivity: 0.1, nominalLoad: 1650, relaxationLengthX: 0.22, relaxationLengthY: 0.36, optimalTemp: 80, tempWindow: 32, heatRate: 3 },
    },
    engine: {
      torqueCurve: [[1500, 170], [3000, 235], [4500, 270], [6000, 288], [7300, 297], [7900, 280], [8300, 240]],
      idleRPM: 1400, redlineRPM: 8000, limiterRPM: 8300, limiterCutTime: 0.06,
      inertia: 0.09, engineBrakingTorque: 40, throttleResponse: 16, cylinders: 4,
    },
    transmission: { gearRatios: [3.4, 2.3, 1.72, 1.35, 1.1, 0.9], reverseRatio: -3.3, finalDrive: 3.9, shiftTime: 0.1, clutchMaxTorque: 600, efficiency: 0.92, autoShiftUpRPM: 7800, autoShiftDownRPM: 4500 },
    drivetrain: { layout: 'RWD', rearDiff: { type: 'lsd', preload: 60, powerLock: 0.45, coastLock: 0.25 } },
    brakes: { maxTorque: 2600, bias: 0.62, handbrakeTorque: 1200 },
    steering: { maxAngle: 32, ackermann: 0.7, steerSpeed: 5.0, speedSensitivity: 0.7, countersteerAssist: 0.3 },
    aero: { dragCoefficient: 0.7, frontalArea: 1.3, liftCoefFront: 0.0, liftCoefRear: 0.05, angularDrag: 0.3 },
    assists: { abs: false, tcs: false, stability: false },
  }),
  makeVehicle({
    name: 'Drift Car', description: 'Pro-drift build: ~550 hp turbo, 2-way LSD at near-full lock, 60° angle kit, hydraulic handbrake, grippier fronts than rears. TC off by default; throttle steers the angle.',
    color: 0x7c4dff, accent: 0x00e5ff, style: 'drift',
    body: {
      mass: 1250, cgHeight: 0.46, weightDistFront: 0.53, groundClearance: 0.09,
      dimensions: { width: 1.95, height: 1.28, length: 4.5 },
      inertiaScale: { x: 0.9, y: 0.8, z: 0.9 }, bodyFriction: 0.45,
    },
    geometry: { wheelbase: 2.53, trackFront: 1.62, trackRear: 1.6 },
    suspension: {
      front: { springRate: 75000, bumpDamping: 3600, reboundDamping: 5600, restLength: 0.24, travel: 0.11, antiRollBar: 26000, camber: -5, camberGain: 8, toe: -0.15, caster: 9, rollCenterHeight: 0.05 },
      rear: { springRate: 65000, bumpDamping: 3400, reboundDamping: 5200, restLength: 0.24, travel: 0.11, antiRollBar: 32000, camber: -0.8, camberGain: 6, toe: 0, rollCenterHeight: 0.08 },
      antiDive: 0.25, antiSquat: 0.3,
    },
    wheels: { front: { radius: 0.33, width: 0.255, inertia: 1.1 }, rear: { radius: 0.33, width: 0.265, inertia: 1.15 } },
    tires: {
      // grippy front semi-slicks; harder rears with a flat post-peak curve so a slide is
      // progressive and holdable instead of snapping
      front: { peakFrictionX: 1.2, peakFrictionY: 1.22, peakSlipRatio: 0.1, peakSlipAngle: 7, shapeY: { C: 1.35, E: 0.0 }, loadSensitivity: 0.1 },
      rear: { peakFrictionX: 1.1, peakFrictionY: 1.02, peakSlipRatio: 0.11, peakSlipAngle: 9, shapeX: { C: 1.4, E: 0.3 }, shapeY: { C: 1.15, E: 0.3 }, loadSensitivity: 0.1, heatRate: 4 },
    },
    engine: {
      torqueCurve: [[1000, 260], [2500, 380], [3500, 560], [4500, 660], [6000, 640], [7200, 560], [7800, 500]],
      idleRPM: 950, redlineRPM: 7600, limiterRPM: 7900, limiterCutTime: 0.05,
      inertia: 0.13, engineBrakingTorque: 55, throttleResponse: 16, cylinders: 6,
      turbo: { maxBoost: 0.12, spoolRate: 2.2 },
    },
    transmission: { gearRatios: [3.2, 2.15, 1.6, 1.25, 1.0, 0.85], reverseRatio: -3.2, finalDrive: 4.1, shiftTime: 0.09, clutchMaxTorque: 1200, efficiency: 0.9, autoShiftUpRPM: 7400, autoShiftDownRPM: 4500 },
    drivetrain: { layout: 'RWD', rearDiff: { type: 'lsd', preload: 250, powerLock: 0.9, coastLock: 0.75 } },
    brakes: { maxTorque: 6000, bias: 0.64, handbrakeTorque: 5500 },
    // angle kit; keep most of the lock available at speed so you can countersteer
    steering: { maxAngle: 60, ackermann: 0.0, steerSpeed: 6.0, speedSensitivity: 0.25, countersteerAssist: 0.55 },
    aero: { dragCoefficient: 0.36, frontalArea: 2.05, liftCoefFront: -0.1, liftCoefRear: -0.15, angularDrag: 0.3 },
    assists: { tcs: false, stability: false },
  }),
  makeVehicle({
    name: 'GT3', description: 'GT3-class endurance racer: 1300 kg, ~550 hp front-mid V8, sequential 6-speed, slicks and a big rear wing. ABS and TC are race-legal in GT3, so they stay on.',
    color: 0x1b5e20, accent: 0xffd600, style: 'gt3',
    // glTF body built in Blender (tools/blender/build_gt3rs_991.py); the procedural 'gt3' style is the fallback
    model: { url: 'assets/models/gt3rs-991.glb', prefix: 'GT3RS_', brakeMaterial: 'GT3_Taillight' },
    body: {
      mass: 1300, cgHeight: 0.42, weightDistFront: 0.47, groundClearance: 0.07,
      dimensions: { width: 2.04, height: 1.22, length: 4.65 },
      inertiaScale: { x: 0.85, y: 0.8, z: 0.85 }, bodyFriction: 0.4,
    },
    geometry: { wheelbase: 2.68, trackFront: 1.72, trackRear: 1.68 },
    suspension: {
      front: { springRate: 140000, bumpDamping: 4500, reboundDamping: 7000, fastBumpThreshold: 0.2, fastBumpFactor: 0.4, restLength: 0.2, travel: 0.08, bumpStopRate: 600000, antiRollBar: 45000, camber: -3.5, camberGain: 15, toe: -0.05, caster: 8, rollCenterHeight: 0.04 },
      rear: { springRate: 160000, bumpDamping: 4800, reboundDamping: 7500, fastBumpThreshold: 0.2, fastBumpFactor: 0.4, restLength: 0.2, travel: 0.08, bumpStopRate: 600000, antiRollBar: 30000, camber: -2.5, camberGain: 12, toe: 0.15, rollCenterHeight: 0.07 },
      antiDive: 0.3, antiSquat: 0.3,
    },
    wheels: { front: { radius: 0.34, width: 0.305, inertia: 1.3 }, rear: { radius: 0.355, width: 0.33, inertia: 1.5 } },
    tires: {
      front: { peakFrictionX: 1.55, peakFrictionY: 1.6, peakSlipRatio: 0.08, peakSlipAngle: 6, shapeY: { C: 1.45, E: -0.1 }, loadSensitivity: 0.13, nominalLoad: 3500, relaxationLengthX: 0.2, relaxationLengthY: 0.32, optimalTemp: 90, tempWindow: 30, heatRate: 3.5 },
      rear: { peakFrictionX: 1.6, peakFrictionY: 1.6, peakSlipRatio: 0.08, peakSlipAngle: 6, shapeY: { C: 1.45, E: -0.1 }, loadSensitivity: 0.13, nominalLoad: 3800, relaxationLengthX: 0.2, relaxationLengthY: 0.32, optimalTemp: 90, tempWindow: 30, heatRate: 3.5 },
    },
    engine: {
      torqueCurve: [[1200, 330], [3000, 560], [4500, 640], [5500, 650], [6500, 600], [7300, 540], [7800, 480]],
      idleRPM: 1200, redlineRPM: 7500, limiterRPM: 7700, limiterCutTime: 0.04,
      inertia: 0.15, engineBrakingTorque: 70, throttleResponse: 18, cylinders: 8,
    },
    transmission: { gearRatios: [3.0, 2.2, 1.75, 1.45, 1.22, 1.05], reverseRatio: -3.0, finalDrive: 3.3, shiftTime: 0.05, clutchMaxTorque: 1100, efficiency: 0.92, autoShiftUpRPM: 7300, autoShiftDownRPM: 4800 },
    drivetrain: { layout: 'RWD', rearDiff: { type: 'lsd', preload: 120, powerLock: 0.35, coastLock: 0.2 } },
    brakes: { maxTorque: 9000, bias: 0.58, handbrakeTorque: 1500 },
    steering: { maxAngle: 25, ackermann: 0.4, steerSpeed: 4.5, speedSensitivity: 0.9, countersteerAssist: 0.2 },
    aero: { dragCoefficient: 0.42, frontalArea: 2.0, liftCoefFront: -0.55, liftCoefRear: -0.85, angularDrag: 0.35 },
  }),
  makeVehicle({
    name: 'Formula 1', description: 'Open-wheel F1-style car: ~800 kg, ~920 hp, slicks, 8-speed seamless shift and huge downforce. Grip comes with speed; slow corners need care.',
    color: 0xd50000, accent: 0xf5f5f5, style: 'f1',
    view: { hood: [0.6, 0.43] }, // cockpit camera (y, z relative to CG): driver's eye, under the halo
    body: {
      mass: 800, cgHeight: 0.28, weightDistFront: 0.45, groundClearance: 0.05,
      dimensions: { width: 2.0, height: 0.95, length: 5.6 },
      inertiaScale: { x: 0.55, y: 0.5, z: 0.6 }, bodyFriction: 0.35,
    },
    geometry: { wheelbase: 3.6, trackFront: 1.6, trackRear: 1.55 },
    suspension: {
      front: { springRate: 200000, bumpDamping: 5500, reboundDamping: 8000, fastBumpThreshold: 0.15, fastBumpFactor: 0.35, restLength: 0.12, travel: 0.05, bumpStopRate: 900000, antiRollBar: 70000, camber: -3.2, camberGain: 25, toe: -0.05, rollCenterHeight: 0.04 },
      rear: { springRate: 180000, bumpDamping: 5000, reboundDamping: 7500, fastBumpThreshold: 0.15, fastBumpFactor: 0.35, restLength: 0.12, travel: 0.05, bumpStopRate: 900000, antiRollBar: 45000, camber: -1.8, camberGain: 20, toe: 0.2, rollCenterHeight: 0.06 },
      antiDive: 0.35, antiSquat: 0.4,
    },
    wheels: { front: { radius: 0.36, width: 0.305, inertia: 1.0 }, rear: { radius: 0.36, width: 0.405, inertia: 1.2 } },
    tires: {
      front: { peakFrictionX: 1.75, peakFrictionY: 1.8, peakSlipRatio: 0.08, peakSlipAngle: 5.5, shapeX: { C: 1.6, E: 0.0 }, shapeY: { C: 1.5, E: -0.3 }, loadSensitivity: 0.16, nominalLoad: 3500, relaxationLengthX: 0.18, relaxationLengthY: 0.28, optimalTemp: 100, tempWindow: 30, heatRate: 4 },
      rear: { peakFrictionX: 1.8, peakFrictionY: 1.8, peakSlipRatio: 0.08, peakSlipAngle: 5.5, shapeX: { C: 1.6, E: 0.0 }, shapeY: { C: 1.5, E: -0.3 }, loadSensitivity: 0.16, nominalLoad: 4000, relaxationLengthX: 0.18, relaxationLengthY: 0.28, optimalTemp: 100, tempWindow: 30, heatRate: 4 },
    },
    engine: {
      // 1.6 V6 turbo + hybrid deployment, modelled as one combined curve
      torqueCurve: [[3500, 330], [6000, 470], [8000, 560], [10000, 590], [11000, 580], [12000, 520], [12500, 470]],
      idleRPM: 3500, redlineRPM: 12000, limiterRPM: 12300, limiterCutTime: 0.03,
      inertia: 0.06, engineBrakingTorque: 90, throttleResponse: 25, cylinders: 6,
    },
    transmission: {
      gearRatios: [3.9, 3.0, 2.45, 2.05, 1.75, 1.52, 1.35, 1.2], reverseRatio: -3.5, finalDrive: 4.0,
      shiftTime: 0.03, clutchMaxTorque: 900, clutchEngageRPM: 4500, clutchFullRPM: 6000, efficiency: 0.93,
      autoShiftUpRPM: 11800, autoShiftDownRPM: 8500,
    },
    drivetrain: { layout: 'RWD', rearDiff: { type: 'lsd', preload: 100, powerLock: 0.4, coastLock: 0.3 } },
    brakes: { maxTorque: 14000, bias: 0.56, handbrakeTorque: 1500 },
    steering: { maxAngle: 22, ackermann: 0.3, steerSpeed: 5.0, speedSensitivity: 0.9, countersteerAssist: 0.2 },
    aero: { dragCoefficient: 0.85, frontalArea: 1.5, liftCoefFront: -1.35, liftCoefRear: -1.85, angularDrag: 0.4 },
  }),
  makeVehicle({
    name: 'Kart', description: '125cc two-stroke race kart: 165 kg with driver, ~30 hp, direct drive, solid rear axle, rear-only brakes and no suspension. Tiny, twitchy and brutally direct.',
    color: 0x00b0ff, accent: 0xff6d00, style: 'kart',
    view: { hood: [0.62, -0.12] }, // driver's eye
    body: {
      mass: 165, cgHeight: 0.25, weightDistFront: 0.42, groundClearance: 0.03,
      dimensions: { width: 1.4, height: 0.95, length: 1.85 },
      inertiaScale: { x: 0.6, y: 0.6, z: 0.7 }, bodyFriction: 0.4,
    },
    geometry: { wheelbase: 1.04, trackFront: 1.15, trackRear: 1.4 },
    // No real suspension: a stiff spring/damper stands in for chassis + tyre flex,
    // and the "anti-roll bars" represent the frame's torsional stiffness.
    suspension: {
      front: { springRate: 60000, bumpDamping: 900, reboundDamping: 1200, fastBumpThreshold: 0.1, fastBumpFactor: 0.5, restLength: 0.03, travel: 0.02, bumpStopRate: 250000, antiRollBar: 9000, camber: -0.5, camberGain: 0, toe: 0, caster: 14, steerJacking: 0.04, rollCenterHeight: 0.05 },
      rear: { springRate: 55000, bumpDamping: 900, reboundDamping: 1200, fastBumpThreshold: 0.1, fastBumpFactor: 0.5, restLength: 0.03, travel: 0.02, bumpStopRate: 250000, antiRollBar: 6000, camber: 0, camberGain: 0, toe: 0, rollCenterHeight: 0.07 },
      antiDive: 0, antiSquat: 0,
    },
    wheels: { front: { radius: 0.14, width: 0.12, inertia: 0.03 }, rear: { radius: 0.143, width: 0.18, inertia: 0.05 } },
    tires: {
      front: { peakFrictionX: 1.7, peakFrictionY: 1.8, peakSlipRatio: 0.09, peakSlipAngle: 4.5, shapeY: { C: 1.45, E: -0.2 }, loadSensitivity: 0.12, nominalLoad: 400, relaxationLengthX: 0.1, relaxationLengthY: 0.15, optimalTemp: 60, tempWindow: 25, heatRate: 6, coolRate: 0.03 },
      rear: { peakFrictionX: 1.7, peakFrictionY: 1.75, peakSlipRatio: 0.09, peakSlipAngle: 4.5, shapeY: { C: 1.45, E: -0.2 }, loadSensitivity: 0.12, nominalLoad: 450, relaxationLengthX: 0.1, relaxationLengthY: 0.15, optimalTemp: 60, tempWindow: 25, heatRate: 6, coolRate: 0.03 },
    },
    engine: {
      // 125cc single-cylinder two-stroke (fires every revolution -> audio "cylinders: 2")
      torqueCurve: [[2500, 6], [5000, 10], [7000, 14], [9000, 19], [10500, 21], [11500, 20], [12500, 17], [13500, 13], [14000, 10]],
      idleRPM: 2600, redlineRPM: 13500, limiterRPM: 14000, limiterCutTime: 0.04,
      inertia: 0.012, engineBrakingTorque: 4, throttleResponse: 20, cylinders: 2,
    },
    // Direct drive (12:80 chain) through a centrifugal clutch. Karts have no reverse;
    // it's kept here only so the sandbox can back out of a wall.
    transmission: { gearRatios: [1.0], reverseRatio: -1.0, finalDrive: 6.67, shiftTime: 0.05, clutchMaxTorque: 60, clutchEngageRPM: 5500, clutchFullRPM: 7500, efficiency: 0.95, autoShiftUpRPM: 13500, autoShiftDownRPM: 0 },
    drivetrain: { layout: 'RWD', rearDiff: { type: 'locked' } }, // solid rear axle
    brakes: { maxTorque: 320, bias: 0.0, handbrakeTorque: 160 }, // rear-axle disc only
    steering: { maxAngle: 28, ackermann: 1.0, steerSpeed: 6.0, speedSensitivity: 0.85, countersteerAssist: 0.15 },
    aero: { dragCoefficient: 0.8, frontalArea: 0.55, liftCoefFront: 0, liftCoefRear: 0, angularDrag: 0.3 },
  }),
  makeVehicle({
    name: 'KZ Shifter Kart', description: '125cc two-stroke gearbox (KZ/KZ2) kart: 175 kg with driver, ~55 hp at 12,500 rpm, 6-speed sequential box (G for manual, shift keys/paddles), front and rear brakes, standing starts. 0-60 mph in about 3.9 s, ~105 mph flat out. Same chassis as the direct-drive Kart.',
    color: 0xffd600, accent: 0x111111, style: 'kart',
    view: { hood: [0.62, -0.12] },
    body: {
      mass: 175, cgHeight: 0.25, weightDistFront: 0.36, groundClearance: 0.03,
      dimensions: { width: 1.4, height: 0.95, length: 1.85 },
      inertiaScale: { x: 0.6, y: 0.6, z: 0.7 }, bodyFriction: 0.4,
    },
    geometry: { wheelbase: 1.04, trackFront: 1.15, trackRear: 1.4 },
    suspension: {
      front: { springRate: 60000, bumpDamping: 900, reboundDamping: 1200, fastBumpThreshold: 0.1, fastBumpFactor: 0.5, restLength: 0.03, travel: 0.02, bumpStopRate: 250000, antiRollBar: 9000, camber: -0.5, camberGain: 0, toe: 0, caster: 14, steerJacking: 0.04, rollCenterHeight: 0.05 },
      rear: { springRate: 55000, bumpDamping: 900, reboundDamping: 1200, fastBumpThreshold: 0.1, fastBumpFactor: 0.5, restLength: 0.03, travel: 0.02, bumpStopRate: 250000, antiRollBar: 6000, camber: 0, camberGain: 0, toe: 0, rollCenterHeight: 0.07 },
      antiDive: 0, antiSquat: 0,
    },
    wheels: { front: { radius: 0.14, width: 0.12, inertia: 0.03 }, rear: { radius: 0.143, width: 0.18, inertia: 0.05 } },
    tires: {
      front: { peakFrictionX: 1.7, peakFrictionY: 1.8, peakSlipRatio: 0.09, peakSlipAngle: 4.5, shapeY: { C: 1.45, E: -0.2 }, loadSensitivity: 0.12, nominalLoad: 400, relaxationLengthX: 0.1, relaxationLengthY: 0.15, optimalTemp: 60, tempWindow: 25, heatRate: 6, coolRate: 0.03 },
      rear: { peakFrictionX: 1.7, peakFrictionY: 1.75, peakSlipRatio: 0.09, peakSlipAngle: 4.5, shapeY: { C: 1.45, E: -0.2 }, loadSensitivity: 0.12, nominalLoad: 450, relaxationLengthX: 0.1, relaxationLengthY: 0.15, optimalTemp: 60, tempWindow: 25, heatRate: 6, coolRate: 0.03 },
    },
    engine: {
      // 125cc water-cooled reed-valve two-stroke: narrow, peaky power band (~55 hp at 12,500 rpm, tuned a little hot to match real-world launches)
      torqueCurve: [[4000, 6], [6000, 11], [8000, 17], [9500, 25], [11000, 32], [12500, 34], [13500, 31], [14500, 26], [15500, 17]],
      idleRPM: 4000, redlineRPM: 14800, limiterRPM: 15500, limiterCutTime: 0.03,
      inertia: 0.012, engineBrakingTorque: 4, throttleResponse: 22, cylinders: 2,
    },
    // six close ratios on a ~4.3 final drive; wet clutch that bites at ~9500 rpm (launch at high revs) so it can launch off the line
    transmission: { gearRatios: [3.04, 2.25, 1.8, 1.53, 1.26, 1.0], reverseRatio: -3.0, finalDrive: 4.3, shiftTime: 0.04, clutchMaxTorque: 90, clutchEngageRPM: 9500, clutchFullRPM: 12500, efficiency: 0.93, autoShiftUpRPM: 14500, autoShiftDownRPM: 9500 },
    drivetrain: { layout: 'RWD', rearDiff: { type: 'locked' } },
    brakes: { maxTorque: 420, bias: 0.35, handbrakeTorque: 160 },   // front and rear discs, ~35% front
    steering: { maxAngle: 28, ackermann: 1.0, steerSpeed: 6.0, speedSensitivity: 0.85, countersteerAssist: 0.15 },
    aero: { dragCoefficient: 0.7, frontalArea: 0.55, liftCoefFront: 0, liftCoefRear: 0, angularDrag: 0.3 },
    assists: { abs: false, tcs: false, stability: false },
  }),
  makeVehicle({
    name: 'Off-road Truck', description: 'Heavy 4x4 pickup. Huge travel, high CG, locked rear diff. For jumps and dirt.',
    color: 0x445566, style: 'truck',
    body: { mass: 2200, cgHeight: 0.85, weightDistFront: 0.55, groundClearance: 0.3, dimensions: { width: 2.05, height: 1.75, length: 5.3 }, bodyFriction: 0.5 },
    geometry: { wheelbase: 3.3, trackFront: 1.8, trackRear: 1.8 },
    suspension: {
      front: { springRate: 45000, bumpDamping: 4500, reboundDamping: 6500, restLength: 0.6, travel: 0.4, antiRollBar: 15000, camber: 0, camberGain: 2, rollCenterHeight: 0.2, fastBumpFactor: 0.3 },
      rear: { springRate: 50000, bumpDamping: 4500, reboundDamping: 6500, restLength: 0.6, travel: 0.4, antiRollBar: 8000, camber: 0, camberGain: 2, rollCenterHeight: 0.25, fastBumpFactor: 0.3 },
    },
    wheels: { front: { radius: 0.45, width: 0.31, inertia: 3.0 }, rear: { radius: 0.45, width: 0.31, inertia: 3.0 } },
    tires: {
      front: { peakFrictionX: 0.95, peakFrictionY: 0.9, peakSlipRatio: 0.14, peakSlipAngle: 10, nominalLoad: 6000, shapeY: { C: 1.2, E: 0.3 } },
      rear: { peakFrictionX: 0.95, peakFrictionY: 0.9, peakSlipRatio: 0.14, peakSlipAngle: 10, nominalLoad: 6000, shapeY: { C: 1.2, E: 0.3 } },
    },
    engine: {
      torqueCurve: [[700, 500], [1800, 700], [3000, 760], [4200, 700], [5200, 600], [5800, 520]],
      idleRPM: 700, redlineRPM: 5600, limiterRPM: 5800, inertia: 0.35, engineBrakingTorque: 90, cylinders: 8,
    },
    transmission: { gearRatios: [4.0, 2.5, 1.6, 1.2, 1.0, 0.8], reverseRatio: -3.5, finalDrive: 3.9, clutchMaxTorque: 1300, autoShiftUpRPM: 5300, autoShiftDownRPM: 2400 },
    drivetrain: {
      layout: 'AWD', centerSplitFront: 0.4,
      frontDiff: { type: 'open' }, rearDiff: { type: 'locked' }, centerDiff: { type: 'lsd', preload: 200, powerLock: 0.6, coastLock: 0.4 },
    },
    brakes: { maxTorque: 9000, bias: 0.62, handbrakeTorque: 4000 },
    steering: { maxAngle: 36, steerSpeed: 3.0 },
    aero: { dragCoefficient: 0.45, frontalArea: 3.2, liftCoefFront: 0.05, liftCoefRear: 0.05, angularDrag: 0.4 },
  }),
];

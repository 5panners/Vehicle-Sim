// Surface materials. friction is a multiplier on the tyre's reference grip
// (dry asphalt = 1). Loose surfaces peak at higher slip and keep grip past the peak.
export const SURFACES = [
  { id: 0, name: 'Asphalt',     friction: 1.00, peakSlipScale: 1.0, falloff: 0.00, rollingDrag: 0.000, bump: 0.000, color: [0.23, 0.23, 0.25], dust: null,              smoke: true },
  { id: 1, name: 'Concrete',    friction: 0.95, peakSlipScale: 1.0, falloff: 0.00, rollingDrag: 0.000, bump: 0.002, color: [0.55, 0.55, 0.53], dust: null,              smoke: true },
  { id: 2, name: 'Wet Asphalt', friction: 0.70, peakSlipScale: 0.9, falloff: 0.00, rollingDrag: 0.004, bump: 0.000, color: [0.13, 0.14, 0.17], dust: [0.7, 0.75, 0.8], smoke: false },
  { id: 3, name: 'Gravel',      friction: 0.62, peakSlipScale: 1.8, falloff: 0.55, rollingDrag: 0.030, bump: 0.018, color: [0.55, 0.50, 0.44], dust: [0.6, 0.56, 0.5], smoke: false },
  { id: 4, name: 'Dirt',        friction: 0.68, peakSlipScale: 1.6, falloff: 0.45, rollingDrag: 0.020, bump: 0.012, color: [0.45, 0.33, 0.22], dust: [0.55, 0.42, 0.3], smoke: false },
  { id: 5, name: 'Grass',       friction: 0.50, peakSlipScale: 1.4, falloff: 0.30, rollingDrag: 0.035, bump: 0.010, color: [0.25, 0.42, 0.18], dust: [0.35, 0.45, 0.25], smoke: false },
  { id: 6, name: 'Sand',        friction: 0.48, peakSlipScale: 2.2, falloff: 0.70, rollingDrag: 0.090, bump: 0.008, color: [0.85, 0.76, 0.52], dust: [0.9, 0.82, 0.6], smoke: false },
  { id: 7, name: 'Snow',        friction: 0.32, peakSlipScale: 1.5, falloff: 0.50, rollingDrag: 0.025, bump: 0.006, color: [0.92, 0.94, 0.97], dust: [1, 1, 1],         smoke: false },
  { id: 8, name: 'Ice',         friction: 0.12, peakSlipScale: 0.8, falloff: 0.10, rollingDrag: 0.000, bump: 0.000, color: [0.70, 0.85, 0.95], dust: [0.9, 0.95, 1],     smoke: false },
  { id: 9, name: 'Kerb',        friction: 0.90, peakSlipScale: 1.0, falloff: 0.00, rollingDrag: 0.002, bump: 0.020, color: [0.8, 0.1, 0.1],    dust: null,              smoke: true },
];
export const SURF = Object.fromEntries(SURFACES.map((s) => [s.name.replace(' ', ''), s.id]));

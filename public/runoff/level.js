// Runoff's physics constants and level generator, kept free of the DOM so they can be tested.

export const PX_PER_M = 20;
export const START_SPEED = 360, ACCEL = 16, MAX_SPEED = 900;  // px/s; 900 px/s is 45 m/s (see src/games.ts)
export const G = 2300, JUMP_V = 780, JUMP_CUT = 0.45;         // releasing early cuts the jump short
export const GLIDE_FALL = 260, GLIDE_TIME = 0.35;             // hold while falling to glide, once per jump
export const COYOTE = 0.09, BUFFER = 0.12;                    // grace windows for jumping late or early
export const WATER_Y = 492, ROOF_MIN = 245, ROOF_MAX = 430;
export const CRATE = 30, CRATE_SLOW = 0.78, MIN_SPEED = 260;
export const RECOVER = 260;                                   // px/s² back up to cruising speed after a crate
// Share of a full jump's horizontal reach that gaps use: [narrowest, widest] at the starting
// speed and at top speed. The widest gaps leave a little room for jumping early.
export const GAP_EASY = [0.35, 0.72], GAP_HARD = [0.6, 0.85];
// How many seconds each roof takes to cross: [shortest, longest] at the start and at top speed.
export const ROOF_EASY = [1.0, 2.0], ROOF_HARD = [0.6, 1.3];
// Chance that a long roof has crates, at the start and at top speed.
export const CRATES_EASY = 0.3, CRATES_HARD = 0.7;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;

// How far through the difficulty ramp a duck at this speed is, from 0 to 1.
export const difficulty = speed => clamp((speed - START_SPEED) / (MAX_SPEED - START_SPEED), 0, 1);

// Seconds in the air for a full jump that lands `dh` px below where it took off (negative is higher).
export function airTime(dh) {
  return (JUMP_V + Math.sqrt(JUMP_V * JUMP_V + 2 * G * dh)) / G;
}

// Picks the roof after `prev` for a duck cruising at `speed`. Gaps widen and roofs shorten as
// the duck speeds up, but every gap can be cleared with a full jump and no glide at that speed.
// A duck that has just been slowed by a crate gets no such promise.
export function nextBuilding(prev, speed, random = Math.random) {
  const rand = (a, b) => a + random() * (b - a);
  const s = Math.max(speed, START_SPEED), k = difficulty(s);
  const top = clamp(prev.top + rand(-95, 130), ROOF_MIN, ROOF_MAX);
  const reach = s * airTime(top - prev.top);
  const gap = reach * rand(lerp(GAP_EASY[0], GAP_HARD[0], k), lerp(GAP_EASY[1], GAP_HARD[1], k));
  const w = Math.max(260, s * rand(lerp(ROOF_EASY[0], ROOF_HARD[0], k), lerp(ROOF_EASY[1], ROOF_HARD[1], k)));
  return { x: prev.x + prev.w + Math.max(50, gap), w, top, crates: random() < lerp(CRATES_EASY, CRATES_HARD, k) };
}

// Runoff's physics constants and level generator, kept free of the DOM so they can be tested.

export const PX_PER_M = 20;
export const START_SPEED = 330, ACCEL = 9, MAX_SPEED = 900;  // px/s; 900 px/s is 45 m/s (see src/games.ts)
export const G = 2300, JUMP_V = 780, JUMP_CUT = 0.45;        // releasing early cuts the jump short
export const GLIDE_FALL = 170, GLIDE_TIME = 0.8;             // hold while falling to glide, once per jump
export const COYOTE = 0.09, BUFFER = 0.12;                   // grace windows for jumping late or early
export const WATER_Y = 492, ROOF_MIN = 245, ROOF_MAX = 430;
export const CRATE = 30, CRATE_SLOW = 0.78, MIN_SPEED = 260;
// Share of a full jump's horizontal reach that the widest gap may use.
export const GAP_MARGIN = 0.7;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Seconds in the air for a full jump that lands `dh` px below where it took off (negative is higher).
export function airTime(dh) {
  return (JUMP_V + Math.sqrt(JUMP_V * JUMP_V + 2 * G * dh)) / G;
}

// Picks the roof after `prev` for a duck running at `speed`. Every gap can be cleared with a
// full jump and no glide at that speed, with some margin for jumping a little early.
export function nextBuilding(prev, speed, random = Math.random) {
  const rand = (a, b) => a + random() * (b - a);
  const s = Math.max(speed, START_SPEED);
  const top = clamp(prev.top + rand(-95, 130), ROOF_MIN, ROOF_MAX);
  const maxGap = s * airTime(top - prev.top) * GAP_MARGIN;
  const gap = rand(Math.max(50, maxGap * 0.4), maxGap);
  const w = Math.max(320, rand(s * 1.0, s * 2.4));
  return { x: prev.x + prev.w + gap, w, top };
}

// Turns gravity readings into a steering value in [-1, 1].
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const rawRoll = (ax, ay) => Math.atan2(ax, ay);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Defaults eased after TV play tests (were 0.45 / 0.05 / 0.35): full steer now needs ~46° of rotation.
export function createTiltReader({ maxAngle = 0.8, deadzone = 0.08, smoothing = 0.2 } = {}) {
  let zero = 0;
  let sign = 1;
  let roll = 0;
  let value = 0;
  const offset = () => wrapAngle(roll - zero);

  return {
    feed(ax, ay) {
      roll = rawRoll(ax, ay);
      let target = clamp((sign * offset()) / maxAngle, -1, 1);
      if (Math.abs(target) < deadzone) target = 0;
      value += smoothing * (target - value);
      return value;
    },
    calibrateZero() {
      zero = roll;
      value = 0;
    },
    // Call while the player tilts right. Returns false if they haven't tilted far enough.
    calibrateRight() {
      const off = offset();
      if (Math.abs(off) < 0.15) return false;
      sign = off > 0 ? 1 : -1;
      return true;
    },
    setSign(s) {
      sign = s;
    },
    get sign() {
      return sign;
    },
    get value() {
      return value;
    },
  };
}

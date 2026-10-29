// Pure helpers that turn session state into sound cues, so the game loop wires audio in with one call a frame:
//   const cues = createCueTracker();           // once
//   playCues(audio, cues.update(session), session.walker.speed);   // every frame
// Nothing here touches Web Audio or the DOM, so it is all unit-tested.

export const WALK_STRIDE = 0.7; // metres between footfalls while walking
export const RUN_STRIDE = 1.1; // ...and while running
export const RUN_SPEED = 2; // m/s: above this the walker counts as running
const MOVING_SPEED = 0.05; // m/s: below this he is standing still

const strideFor = (speed) => (speed > RUN_SPEED ? RUN_STRIDE : WALK_STRIDE);

// Should a footstep play this frame?
//   prevPhase: the phase on the previous frame
//   prevDist:  the walker.z of the previous footfall (or where the current stride started)
// True when the walker is on the ground, moving, in the 'playing' phase (both frames, so a fresh start never
// fires on stale distance) and has covered a full stride since prevDist.
export function stepCue(prevPhase, prevDist, walker, phase) {
  if (phase !== 'playing' || prevPhase !== 'playing') return false;
  if (!walker || walker.airborne || walker.fallen) return false;
  if (!(walker.speed > MOVING_SPEED) || !Number.isFinite(prevDist)) return false;
  return Math.abs(walker.z - prevDist) >= strideFor(walker.speed);
}

// Stateful wrapper around stepCue. update(walker, phase) -> 'step' | null.
// While he is airborne, fallen, standing still or the game is not 'playing', the stride restarts from where
// he is, so the first footfall after landing, setting off or resuming comes one full stride later.
export function createStepTracker() {
  let prevPhase = null;
  let prevDist = null;
  return {
    update(walker, phase) {
      const hit = stepCue(prevPhase, prevDist, walker, phase);
      if (hit) {
        const stride = strideFor(walker.speed);
        prevDist += Math.sign(walker.z - prevDist) * stride; // keep the cadence free of drift...
        if (Math.abs(walker.z - prevDist) >= stride) prevDist = walker.z; // ...but resync after a long frame
      } else if (prevPhase !== 'playing' || !Number.isFinite(prevDist) || !walkingOnPlanks(walker, phase)) {
        prevDist = walker ? walker.z : null; // a new stride starts here
      }
      prevPhase = phase;
      return hit ? 'step' : null;
    },
    reset() {
      prevPhase = null;
      prevDist = null;
    },
  };
}

function walkingOnPlanks(walker, phase) {
  return phase === 'playing' && !!walker && !walker.airborne && !walker.fallen && walker.speed > MOVING_SPEED;
}

// Cue names for this frame, from state transitions in the session:
//   'jump' (airborne false -> true), 'land' (true -> false, only if he did not fall), 'fall' (entering
//   phase 'falling', once), and 'step' (from the step tracker). The first update only records a baseline.
export function createCueTracker() {
  const steps = createStepTracker();
  let seen = false;
  let wasAirborne = false;
  let prevPhase = null;
  return {
    update(session) {
      const cues = [];
      const walker = session && session.walker;
      const phase = session && session.phase;
      if (!walker) return cues;
      const airborne = !!walker.airborne;
      if (seen) {
        if (airborne && !wasAirborne) cues.push('jump');
        // Landing in a gap (or toppling mid-air) is a fall, not a thud on the planks.
        if (!airborne && wasAirborne && !walker.fallen && phase !== 'falling') cues.push('land');
        if (phase === 'falling' && prevPhase !== 'falling') cues.push('fall');
      }
      if (steps.update(walker, phase)) cues.push('step');
      wasAirborne = airborne;
      prevPhase = phase;
      seen = true;
      return cues;
    },
    reset() {
      steps.reset();
      seen = false;
      wasAirborne = false;
      prevPhase = null;
    },
  };
}

// Turn cue names into engine calls. speed (m/s) sets the footstep loudness.
export function playCues(audio, cues, speed = 1.4) {
  for (const cue of cues) {
    if (cue === 'step') audio.footstep(speed);
    else if (cue === 'jump') audio.jump();
    else if (cue === 'land') audio.land();
    else if (cue === 'fall') audio.fallScream();
  }
}

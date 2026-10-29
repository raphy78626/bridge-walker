import * as THREE from 'three';
import { stepGait, clipTimeScale, WALK_STRIDE, RUN_STRIDE } from './gait.js';
import { jumpPose, createPose, POSE_BONES } from './jumpPose.js';

const ARM_WEIGHT = 1.2; // vs 1 for walk/idle: arms end up ~55% of the way to the T-pose (~50 deg out)
const ARM_TRACKS = /^mixamorig:?(Left|Right)(Shoulder|Arm|ForeArm)\.quaternion$/;

// One mixer: Idle/Walk/Run blended by speed, an arms-out layer taken from the T-pose, and the procedural
// jump / landing / falling pose from jumpPose.js laid over the bones afterwards.
export function buildRig(model, clips) {
  const mixer = new THREE.AnimationMixer(model);
  const clip = (name) => THREE.AnimationClip.findByName(clips, name);
  const idle = mixer.clipAction(clip('Idle'));
  const walk = mixer.clipAction(clip('Walk'));
  const run = mixer.clipAction(clip('Run'));
  const tpose = clip('TPose');
  const armsClip = new THREE.AnimationClip('Arms', tpose.duration, tpose.tracks.filter((tr) => ARM_TRACKS.test(tr.name)));
  const arms = mixer.clipAction(armsClip);
  idle.play();
  walk.play(); // all clips always run so their times never restart; only the weights move
  run.play();
  walk.weight = 0;
  run.weight = 0;
  arms.setEffectiveWeight(ARM_WEIGHT).play();

  // Bones are looked up once; a bone the model lacks is simply skipped. The jump pose is blended toward
  // bind * Euler (the bind pose is the T-pose, whose local axes are what jumpPose.js describes).
  const pose = createPose();
  const driven = [];
  for (const name of POSE_BONES) {
    const bone = model.getObjectByName('mixamorig' + name);
    if (bone) driven.push({ bone, rest: bone.quaternion.clone(), o: pose.bones[name] });
  }
  const euler = new THREE.Euler();
  const delta = new THREE.Quaternion();
  const target = new THREE.Quaternion();
  let groundSpeed = 0; // the last speed on the planks: the gait mix holds through a jump
  let wasAirborne = false;
  let tAir = 0;
  let tLand = Infinity;
  const state = { airborne: false, vy: 0, tAir: 0, tLand: Infinity, falling: false, tFall: 0, lead: 1 }; // reused every frame
  let tuckLead = 1; // the tuck leads with the other leg each jump

  return {
    pose,
    // state: { speed (m/s), falling, airborne, vy (m/s), fallTime (s into the fall) }
    update({ speed, falling, airborne, vy, fallTime }, dt) {
      if (airborne && !wasAirborne) {
        tAir = 0;
        tuckLead = -tuckLead;
      } else if (!airborne && wasAirborne) {
        tLand = 0;
      }
      wasAirborne = airborne;
      if (!airborne) groundSpeed = speed;
      const g = stepGait({ walk: walk.weight, run: run.weight }, airborne ? groundSpeed : speed, dt);
      idle.weight = g.idle;
      walk.weight = g.walk;
      run.weight = g.run;
      // Walk and Run cycles are not the same length, so while they blend the quieter one follows
      // the louder one's phase; otherwise the feet fight each other for a third of a second.
      if (walk.weight > 0 && run.weight > 0) {
        const [lead, follow] = run.weight >= walk.weight ? [run, walk] : [walk, run];
        follow.time = (lead.time / lead.getClip().duration) * follow.getClip().duration;
      }
      // Frozen in the air so the legs do not keep walking; they pick up where they stopped on landing.
      walk.timeScale = airborne ? 0 : clipTimeScale(speed, WALK_STRIDE, walk.getClip().duration, 0.6, 1.5);
      run.timeScale = airborne ? 0 : clipTimeScale(speed, RUN_STRIDE, run.getClip().duration, 0.7, 1.4);
      idle.timeScale = falling ? 2.5 : 1; // flailing
      mixer.update(dt);

      state.airborne = airborne;
      state.vy = vy;
      state.tAir = tAir;
      state.tLand = tLand;
      state.falling = falling;
      state.tFall = fallTime;
      state.lead = tuckLead;
      jumpPose(state, pose);
      for (let i = 0; i < driven.length; i++) {
        const d = driven[i];
        const w = d.o[3];
        if (w < 0.001) continue;
        euler.set(d.o[0] / w, d.o[1] / w, d.o[2] / w);
        target.multiplyQuaternions(d.rest, delta.setFromEuler(euler));
        d.bone.quaternion.slerp(target, Math.min(1, w));
      }
      tAir += dt;
      tLand += dt;
    },
  };
}

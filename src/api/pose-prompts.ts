// Pure prompt builders (no sharp): every Muse Image prompt comes from the MotionProfile.
// The sheet scaffold (frame count, equal columns, magenta gaps, side profile) lives here and never comes from
// the model; its cycle.prompt is only a trailing hint. defaultProfile('dog') reproduces the original dog prompts.
import type { CycleKind, MotionProfile } from '../../contracts/types.js';
import { SHEET } from './profile-defaults.js';

export function styleFor(p: MotionProfile): string {
  const quad = p.locomotion === 'quadruped';
  return (
    'Render the exact same pet from the reference photo as a cute 3D animated-movie character, ' +
    `Pixar-style: ${quad ? 'soft volumetric fur, ' : ''}gentle studio lighting with soft highlights, subtle ambient occlusion, ` +
    `slightly stylised proportions (big expressive glossy eyes, rounded body), same ${quad ? 'breed, same fur colour' : 'species, same colours'} and markings. ` +
    'Full body visible, centred, nothing cropped. Thin clean white outline around the silhouette. ' +
    'Solid flat pure magenta background (#FF00FF) filling the whole canvas, no gradient, ' +
    'no ground shadow, no reflections, no props, no text. ' +
    (quad
      ? 'Keep the same soft ears (same shape and how they hang), same face shape and same collar as the reference; ' +
        'do not change the breed or ear shape. '
      : '') +
    (p.subject === 'dog' ? '' : `This is a ${p.subject}; keep its ${p.styleHints} exactly as in the reference. `) +
    'Leave a clear margin of empty background on all four sides so nothing touches the canvas edge.'
  );
}

const side =
  'drawn in strict side profile facing right: the camera is level and perpendicular to the body, only one eye visible, the head points right and does not look at the camera.';
const frames4 = (what: string, f: [string, string, string, string], fixed: string) =>
  `A horizontal sprite sheet of exactly 4 frames of this same character ${what}, ${side} ` +
  `Frame 1: ${f[0]}. Frame 2: ${f[1]}. Frame 3: ${f[2]}. Frame 4: ${f[3]}. ` +
  `Same size and same position in every frame; ${fixed}. Evenly spaced in 4 equal columns with wide magenta gaps between frames.`;

const FAMILY: Record<Exclude<CycleKind, 'walk'>, string> = {
  flap: frames4(
    'flapping its wings in flight',
    ['wings raised high above the body', 'wings halfway down', 'wings fully down below the body', 'wings halfway up'],
    'body and head fixed, legs tucked away, only the wings move',
  ),
  hop: frames4(
    'hopping',
    ['crouched low, gathering to jump', 'launching, legs pushing off the ground', 'in the air, body stretched out', 'landing, legs absorbing the impact'],
    'only the legs and the body arc move',
  ),
  undulate: frames4(
    'moving by undulating',
    ['body in an S curve bending up at the front', 'body curve flattening out', 'body in an S curve bending down at the front', 'body curve flattening out again'],
    'only the curve of the body changes',
  ),
  spin: frames4(
    'spinning around in place',
    ['facing right in profile', 'turned a quarter turn away', 'facing away from the camera', 'turned a quarter turn back'],
    'only the rotation changes',
  ),
};

const pair = (what: string, a: string, b: string, fixed: string) =>
  `A horizontal sprite sheet of exactly 2 frames of this same character ${what}, ${side} ` +
  `Frame 1: ${a}. Frame 2: ${b}. Same size and same position in both frames; ${fixed}. ` +
  'Two equal columns with a wide magenta gap between the frames.';

// Last resort when two 4-frame sheets failed: just the two extreme poses, which Muse draws well.
const PAIR: Record<CycleKind, string> = {
  walk:
    'A horizontal sprite sheet of exactly 2 frames of this same character mid-stride, drawn in strict side profile facing right: ' +
    "the camera is level and perpendicular to the body, we see the pet's left side, only one eye visible, the head points right. " +
    'Frame 1: left front leg reaching far forward and right hind leg reaching far back. ' +
    'Frame 2: right front leg reaching far forward and left hind leg reaching far back. ' +
    'Same size, same body height and same head position in both frames; only the legs move. ' +
    'Two equal columns with a wide magenta gap between the frames.',
  flap: pair('flapping its wings', 'wings raised high', 'wings fully down', 'body fixed, only the wings move'),
  hop: pair('hopping', 'crouched low', 'in the air, body stretched out', 'only the legs and body arc move'),
  undulate: pair('undulating', 'body in an S curve bending up', 'body in an S curve bending down', 'only the curve of the body changes'),
  spin: pair('spinning', 'facing right in profile', 'turned away from the camera', 'only the rotation changes'),
};

// One sheet of five views of the same character: the identity anchor for every other pose.
function turnSheet(p: MotionProfile): string {
  const wings = p.locomotion === 'fly' ? ', wings spread' : '';
  const quad = p.locomotion === 'quadruped';
  return (
    `A horizontal sprite sheet of exactly 5 views of this same ${p.subject}, all at the same scale, standing on one ground line: ` +
    `View 1: front, facing the camera${wings}. View 2: front three-quarter view, facing right${wings}. ` +
    `View 3: right side profile, facing right${wings}. View 4: back three-quarter view${wings}. View 5: back view, facing away from the camera${wings}. ` +
    `Identical character in every view: same ${p.styleHints}, same markings, colours and proportions${quad ? ', same ears and collar' : ''}. ` +
    'Evenly spaced in 5 equal columns, each view filling at most 65% of its column: every part of the view (head, limbs, tail, wings) stays well inside the column, ' +
    'with a wide empty magenta gutter between neighbouring views and no part of one view touching another.'
  );
}

/** Muse Image prompts by pose name; the sheet is the scaffold for the profile's cycle kind plus the model's hint. */
export function posesFor(p: MotionProfile): Record<string, string> {
  const base = p.cycle.kind === 'walk' ? SHEET : FAMILY[p.cycle.kind];
  const hint = p.cycle.prompt === SHEET ? '' : ` Motion notes: ${p.cycle.prompt}`;
  return {
    idle_0: p.idlePrompt,
    walk_sheet: base + hint,
    walk_pair: PAIR[p.cycle.kind],
    turn_sheet: turnSheet(p),
    sit: p.roles.rest.prompt,
    sleep: p.roles.sleep.prompt,
    bark: p.roles.voice.prompt,
    roll: p.roles.trick.prompt,
    // A pure edit of the idle image: no style prefix, it would invite a redraw.
    idle_blink:
      'Edit this exact image: gently close the eyes in a blink. Change nothing else: same pose, same framing, ' +
      'same size, same position, same lighting, same magenta background.',
  };
}

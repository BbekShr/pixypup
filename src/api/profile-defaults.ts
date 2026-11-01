// Leaf module (no sharp, no pipeline): the app main process imports this, and so do the validators.
import type { CycleKind, Fidget, Locomotion, MotionProfile, RoleName } from '../../contracts/types.js';

export const LOCOMOTIONS: Locomotion[] = ['quadruped', 'biped', 'hop', 'fly', 'slither', 'roll'];
export const CYCLES: CycleKind[] = ['walk', 'flap', 'hop', 'undulate', 'spin'];
export const FIDGETS: Fidget[] = ['groom', 'knead', 'flutter', 'wave', 'phone', 'preen', 'hover', 'bob'];
export const ROLES: RoleName[] = ['rest', 'sleep', 'voice', 'trick'];

export const SPECIES_RE = /^[A-Za-z][A-Za-z -]{0,29}$/;

/** A species safe to put in a prompt; anything else reads as the default 'dog'. */
export const promptSpecies = (species?: string): string => (species && SPECIES_RE.test(species) ? species : 'dog');

type Range = readonly [number, number];
export const RANGE = {
  cadenceHz: [0.5, 8],
  strideBody: [0.1, 4],
  bounce: [0, 0.3],
  pitchDeg: [0, 25],
  speedBody: [0.05, 5],
  minLiftBody: [0, 6],
  maxLiftBody: [0.5, 10],
  flutterHz: [1, 40],
  sway: [0, 1],
} as const satisfies Record<string, Range>;

/** A strideBody outside this band for the locomotion is model noise (live: 0.6 and 1.4 for the same husky). */
export const STRIDE_PLAUSIBLE: Record<Locomotion, Range> = {
  quadruped: [0.5, 1.5],
  biped: [0.4, 1.2],
  hop: [0.8, 3],
  fly: [0.5, 4],
  slither: [0.3, 2],
  roll: [0.8, 4],
};

export const clamp = (v: number, [lo, hi]: Range): number => Math.min(hi, Math.max(lo, v));

// The dog strings are today's pose-pipeline.ts prompts (a test pins them to POSES).
export const SHEET =
  "A horizontal sprite sheet of exactly 4 frames of this same character walking, drawn in strict side profile facing right: " +
  "the camera is level and perpendicular to the body, we see the pet's left side, only one eye visible, " +
  'the head points right in the walking direction and does not look at the camera. All four legs clearly visible and separated. ' +
  'Frame 1: left front leg reaching forward and right hind leg reaching back. ' +
  'Frame 2: legs passing under the body, one front paw slightly lifted, body at the same height as frame 1, back level, ' +
  'not crouching, not jumping. Frame 3: right front leg forward and left hind leg back. Frame 4: legs passing under the body again. ' +
  'Same size, same body height and same head position in every frame; only the legs move. ' +
  'Evenly spaced in 4 equal columns with wide magenta gaps between frames.';

const role = (label: string, prompt: string, bubble?: string) => ({ label, prompt, ...(bubble ? { bubble } : {}) });

const DOG: MotionProfile = {
  locomotion: 'quadruped',
  subject: 'dog',
  styleHints: 'floppy ears, wagging tail',
  // Approximations of the overlay constants: STRIDE 0.22 x 4 frames, 8 fps, bob 4 px of 140, LEAN_DEG 2, MAX_SPEED 90 px/s.
  gait: { cadenceHz: 2, strideBody: 0.88, bounce: 0.03, pitchDeg: 2, speedBody: 0.5 },
  cycle: { kind: 'walk', prompt: SHEET },
  idlePrompt: 'Pose: standing on all four legs, side view facing right, tail relaxed.',
  fidgets: ['groom', 'bob'],
  roles: {
    rest: role('Sit', 'Pose: sitting upright facing the viewer, front paws together.'),
    sleep: role('Sleep', 'Pose: curled up asleep lying down, eyes closed, side view.'),
    voice: role('Bark', 'Pose: barking happily, side view facing right, mouth open, ears perked.', 'Woof!'),
    trick: role('Roll over', 'Pose: rolling over on its back, belly up, paws in the air, playful.'),
  },
  energy: 'playful',
};

const CAT: MotionProfile = {
  ...DOG,
  subject: 'cat',
  styleHints: 'pointed ears, long tail',
  gait: { ...DOG.gait, bounce: 0.02, speedBody: 0.45 },
  fidgets: ['groom', 'knead'],
  roles: {
    ...DOG.roles,
    voice: role('Meow', 'Pose: meowing, side view facing right, mouth open, ears perked.', 'Meow!'),
    trick: role('Stretch', 'Pose: stretching, front paws far forward, rear up, playful.'),
  },
  energy: 'normal',
};

const flapSheet = (what: string) =>
  `A horizontal sprite sheet of exactly 4 frames of this same character ${what}, drawn in strict side profile facing right, ` +
  'the head pointing right. Same size and same body position in every frame; only the wings move. ' +
  'Evenly spaced in 4 equal columns with wide magenta gaps between frames.';

const AIR = { minLiftBody: 1, maxLiftBody: 4, flutterHz: 6, perches: true, sway: 0.4 };
const FLYER: MotionProfile = {
  ...DOG,
  locomotion: 'fly',
  styleHints: 'wing shape and colours, beak or antennae',
  idlePrompt: 'Pose: hovering in place, wings half open, side view facing right.',
  gait: { cadenceHz: 6, strideBody: 2, bounce: 0.05, pitchDeg: 8, speedBody: 1 },
  air: AIR,
  cycle: { kind: 'flap', prompt: flapSheet('flapping its wings in flight') },
  fidgets: ['preen', 'flutter', 'hover'],
  roles: {
    rest: role('Perch', 'Pose: perched calmly, wings folded, side view facing right.'),
    sleep: role('Sleep', 'Pose: asleep, eyes closed, wings folded, side view.'),
    voice: role('Chirp', 'Pose: singing happily, side view facing right, beak open.', 'Chirp!'),
    trick: role('Twirl', 'Pose: mid-air twirl with wings spread wide, playful.'),
  },
};

const BUTTERFLY: MotionProfile = {
  ...FLYER,
  styleHints: 'wing pattern and colours, antennae',
  gait: { cadenceHz: 3, strideBody: 1.5, bounce: 0.08, pitchDeg: 10, speedBody: 0.7 },
  air: { ...AIR, flutterHz: 3, perches: true, sway: 0.8 },
  fidgets: ['flutter', 'hover', 'bob'],
  roles: {
    ...FLYER.roles,
    rest: role('Land', 'Pose: resting on a flat surface, wings folded upright, side view.'),
    voice: role('Flutter', 'Pose: wings spread wide open, facing the viewer.', 'Hello!'),
  },
};

const FISH: MotionProfile = {
  ...FLYER,
  styleHints: 'fins, tail and scale colours',
  idlePrompt: 'Pose: floating still, fins relaxed, side view facing right.',
  gait: { cadenceHz: 2, strideBody: 1.5, bounce: 0.04, pitchDeg: 6, speedBody: 0.7 },
  air: { ...AIR, flutterHz: 2, perches: false, sway: 0.6 },
  cycle: { kind: 'undulate', prompt: flapSheet('swimming, tail and body swaying side to side') },
  fidgets: ['bob', 'hover'],
  roles: {
    rest: role('Float', 'Pose: floating still, fins relaxed, side view facing right.'),
    sleep: role('Sleep', 'Pose: asleep, eyes closed, drifting, side view.'),
    voice: role('Blub', 'Pose: blowing a bubble, mouth open, side view facing right.', 'Blub!'),
    trick: role('Flip', 'Pose: arching in a playful leap, side view facing right.'),
  },
};

const RABBIT: MotionProfile = {
  ...DOG,
  locomotion: 'hop',
  styleHints: 'long upright ears, fluffy tail',
  gait: { cadenceHz: 1.5, strideBody: 1.6, bounce: 0.15, pitchDeg: 6, speedBody: 0.7 },
  cycle: { kind: 'hop', prompt: flapSheet('hopping (crouch, push off, mid-air, landing)').replace('only the wings move', 'only the legs and body arc move') },
  fidgets: ['groom', 'bob'],
  roles: {
    ...DOG.roles,
    voice: role('Thump', 'Pose: standing tall on hind legs, ears up, alert, side view facing right.', 'Thump!'),
    trick: role('Binky', 'Pose: leaping joyfully in the air, body twisted, playful.'),
  },
};

const SNAKE: MotionProfile = {
  ...DOG,
  locomotion: 'slither',
  styleHints: 'scale pattern and head shape',
  idlePrompt: 'Pose: resting with the head raised, body gently curved, side view facing right.',
  gait: { cadenceHz: 1.5, strideBody: 0.8, bounce: 0, pitchDeg: 0, speedBody: 0.4 },
  cycle: { kind: 'undulate', prompt: flapSheet('slithering, body in an S curve that shifts each frame').replace('only the wings move', 'only the body curve changes') },
  fidgets: ['bob', 'hover'],
  roles: {
    rest: role('Coil', 'Pose: coiled up calmly, head raised, side view facing right.'),
    sleep: role('Sleep', 'Pose: coiled up asleep, eyes closed, head resting on the coil.'),
    voice: role('Hiss', 'Pose: rearing up, mouth open, tongue out, side view facing right.', 'Hiss!'),
    trick: role('Dance', 'Pose: swaying upright in a playful dance, side view.'),
  },
  energy: 'normal',
};

// First match wins. Breeds fall back to the dog row through their usual names.
const TABLE: [RegExp, MotionProfile][] = [
  [/butterfl|moth|\bbee\b|dragonfl|ladybug/, BUTTERFLY],
  [/bird|parrot|owl|duck|chick|penguin|sparrow|finch|budgie/, FLYER],
  [/fish|shark|whale|dolphin/, FISH],
  [/snake|serpent|worm/, SNAKE],
  [/rabbit|bunny|hare/, RABBIT],
  [/\bcat\b|kitten|kitty/, CAT],
  [/dog|pupp|husky|retriever|shepherd|terrier|poodle|corgi|labrador|shiba|bulldog|beagle|collie|dachshund|pug|spaniel|hound/, DOG],
];

/** Fixed motion for a species when Spark is slow or fails. 'dog' is exactly today's Pakkun; an unknown species walks like a quadruped. */
export function defaultProfile(species: string): MotionProfile {
  const s = species.toLowerCase();
  const base = TABLE.find(([re]) => re.test(s))?.[1] ?? DOG;
  return structuredClone({ ...base, subject: species.trim().toLowerCase().slice(0, 60) || base.subject });
}

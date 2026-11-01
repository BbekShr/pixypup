// Entry for docs/js/puppet.js: the app's own walk-stride maths, bundled for the landing page (npm run site-js).
import { alphaPlane } from '../src/overlay/frames';
import { walkFrame } from '../src/overlay/motion';
import { strideFromFrames } from '../src/overlay/stride';

(window as unknown as { PixyPuppet: object }).PixyPuppet = { alphaPlane, walkFrame, strideFromFrames };

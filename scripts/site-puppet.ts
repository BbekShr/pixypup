// Entry for docs/js/puppet.js: the app's own walk rig, bundled for the landing page (npm run site-js).
import { alphaPlane } from '../src/overlay/frames';
import { headX, walkFrame } from '../src/overlay/motion';
import { GAITS, bakeWalk, legBand, puppetSpecies } from '../src/overlay/puppet';

(window as unknown as { PixyPuppet: object }).PixyPuppet = { alphaPlane, headX, walkFrame, GAITS, bakeWalk, legBand, puppetSpecies };

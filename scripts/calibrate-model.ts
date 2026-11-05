// Regenerate the supplied-player calibration record from the committed GLB (run after the artwork is rebuilt with
// models/scripts/build-v6.sh). tests/model.test.ts checks the committed record still matches the GLB.
import { writeFileSync } from 'node:fs';
import { calibrate } from './model/calibrate';

const out = 'src/sim/model/bew-v6.calibration.json';
const rec = calibrate(process.argv[2] ?? 'models/bew-v6.glb');
writeFileSync(out, JSON.stringify(rec, null, 1) + '\n');
console.log(`wrote ${out}`);
console.log(JSON.stringify({ frame: rec.frame, lengths: rec.lengths, radii: rec.radii, glove: rec.glove, shoe: rec.shoe, torso: rec.torso, pelvis: rec.pelvis, helmet: rec.helmet, landmarks: rec.landmarks, segmentRest: rec.segmentRest }, null, 0));

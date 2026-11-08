// Regenerate the run-clip and idle intake records from models/animations/ (after re-baking a clip with bake_clip.py).
// tests/locomotion.test.ts checks the committed record still matches the assets.
import { writeFileSync } from 'node:fs';
import { clipIntake } from './model/clip-intake';
import { idleIntake } from './model/idle-intake';

const out = 'src/sim/model/run-clips.record.json';
const rec = clipIntake();
writeFileSync(out, JSON.stringify(rec, null, 1) + '\n');
console.log(`wrote ${out}`);
for (const c of rec.clips) console.log(JSON.stringify(c));
const idleOut = 'src/sim/model/idle-pose.record.json';
const idle = idleIntake();
writeFileSync(idleOut, JSON.stringify(idle, null, 1) + '\n');
console.log(`wrote ${idleOut}`);
console.log(JSON.stringify(idle));

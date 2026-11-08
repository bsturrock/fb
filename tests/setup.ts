// Vitest setup (every test file): free the engine world of any simulation a file created through tests/helpers and
// left undisposed, so Rapier WASM memory does not grow across a worker's files.
import { afterAll } from 'vitest';
import { SIM_DEFAULTS } from '../src/sim/simulation';
import { disposeTracked } from './helpers';

// plan 10c (C7): tests read the force and effort ledgers; the lab default keeps them off
SIM_DEFAULTS.ledgers = true;

afterAll(() => disposeTracked());

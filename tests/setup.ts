// Vitest setup (every test file): free the engine world of any simulation a file created through tests/helpers and
// left undisposed, so Rapier WASM memory does not grow across a worker's files.
import { afterAll } from 'vitest';
import { disposeTracked } from './helpers';

afterAll(() => disposeTracked());

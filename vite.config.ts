import { defineConfig } from 'vite';

export default defineConfig({
  // The supplied model is imported as a hashed asset (src/lab/player-model.ts, `?url`); models/ is source art, not a
  // public directory (the FBX, references and build scripts must not ship).
  publicDir: false,
  server: { port: 5197, strictPort: true },
  test: { environment: 'node', testTimeout: 120000 },
} as any);

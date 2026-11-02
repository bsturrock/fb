import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: 'models',
  server: { port: 5197, strictPort: true },
  test: { environment: 'node', testTimeout: 120000 },
} as any);

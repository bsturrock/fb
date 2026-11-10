import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Plan 14: the run lab (src/lab/run-lab.ts) reads and saves its Fast Run keyframe edits through the dev server: GET
 * returns models/animations/fast-run.edits.json (404 while there is none), POST replaces it with the body, checked to
 * be an edits file. Dev server only: a built lab has no endpoint and keeps its edits in the page.
 */
function clipEdits(): Plugin {
  const file = fileURLToPath(new URL('./models/animations/fast-run.edits.json', import.meta.url));
  return {
    name: 'lab-clip-edits',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__lab/clip-edits', (req, res) => {
        if (req.method === 'GET') {
          if (!existsSync(file)) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.setHeader('content-type', 'application/json');
          res.end(readFileSync(file));
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (c: string) => {
          body += c;
          if (body.length > 1_000_000) req.destroy();
        });
        req.on('end', () => {
          try {
            const j = JSON.parse(body) as { version?: unknown; clip?: unknown; edits?: unknown };
            if (j?.version !== 1 || j.clip !== 'fast-run' || !Array.isArray(j.edits)) throw new Error('not a fast-run edits file');
            writeFileSync(file, body.endsWith('\n') ? body : `${body}\n`);
            res.statusCode = 204;
            res.end();
          } catch (e) {
            res.statusCode = 400;
            res.end(e instanceof Error ? e.message : String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({
  // The supplied model is imported as a hashed asset (src/lab/player-model.ts, `?url`); models/ is source art, not a
  // public directory (the FBX, references and build scripts must not ship).
  publicDir: false,
  plugins: [clipEdits()],
  server: { port: 5197, strictPort: true },
  test: { environment: 'node', testTimeout: 120000, setupFiles: ['tests/setup.ts'] },
});

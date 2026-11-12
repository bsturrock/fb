// The full check's pass inputs (scripts/check/README.md "Reuse"): every file the export and matrix runs execute or read,
// found as the static import closure of the pass worker and the full check's merge (relative imports of any extension;
// src/ loads its clips and model records by import, never from disk), plus what resolves bare imports (the installed
// package tree, node_modules/.package-lock.json) and the Node version. Two trees with the same digest run the same pass.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOTS = ['scripts/check/pass.ts', 'scripts/check/full-check.ts', 'vite.config.ts', 'tsconfig.json'];
const EXT = ['', '.ts', '.tsx', '.js', '.mjs', '.json', '/index.ts', '/index.js'];
/** `import x from '...'`, `export ... from '...'`, `import '...'`, `import('...')` (string literals only). */
const SPEC = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g;

function resolveRel(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec.replace(/\?.*$/, ''));
  for (const e of EXT) {
    const p = base + e;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

/** The pass's input files under `root` (sorted, relative), and the ones an import named but none resolved to. */
export function passInputFiles(root: string): { files: string[]; unresolved: string[] } {
  const seen = new Set<string>();
  const unresolved: string[] = [];
  const todo = ROOTS.map((r) => join(root, r)).filter((p) => existsSync(p));
  while (todo.length) {
    const f = todo.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    if (!/\.(ts|tsx|js|mjs)$/.test(f)) continue;
    // comments may name a path in import form: they only add files, never hide one
    for (const m of readFileSync(f, 'utf8').matchAll(SPEC)) {
      const spec = m[1];
      // relative imports only (bare ones resolve into node_modules, digested as the package tree)
      if (!/^\.\.?\//.test(spec)) continue;
      const r = resolveRel(f, spec);
      if (r) todo.push(r);
      else unresolved.push(`${relative(root, f)}: ${spec}`);
    }
  }
  return { files: [...seen].map((f) => relative(root, f)).sort(), unresolved: unresolved.sort() };
}

/**
 * The digest of the pass's inputs: each input file's path and bytes, the installed package tree and the Node version.
 * Null when an import cannot be resolved (nothing to vouch for then).
 */
export function passInputDigest(root: string): { digest: string | null; files: number; unresolved: string[] } {
  const { files, unresolved } = passInputFiles(root);
  const h = createHash('sha256');
  for (const f of files) h.update(`${f}\0`).update(readFileSync(join(root, f))).update('\0');
  const lock = join(root, 'node_modules/.package-lock.json');
  h.update('node_modules/.package-lock.json\0').update(existsSync(lock) ? readFileSync(lock) : 'none').update('\0');
  h.update(`node ${process.version}`);
  return { digest: unresolved.length ? null : h.digest('hex'), files: files.length, unresolved };
}

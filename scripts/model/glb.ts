// Minimal node-side GLB reader for asset calibration and tests: JSON + BIN chunks, typed accessors, node world
// matrices and embedded PNG decoding (8-bit, non-interlaced RGB/RGBA). No browser APIs; runtime loading uses Three's
// GLTFLoader (src/lab/player-model.ts).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import * as THREE from 'three';

export interface GlbFile {
  path: string;
  bytes: number;
  sha256: string;
  json: any;
  bin: Uint8Array;
}

export function readGlb(path: string): GlbFile {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binLen = buf.readUInt32LE(20 + jsonLen);
  const bin = new Uint8Array(buf.buffer, buf.byteOffset + 20 + jsonLen + 8, binLen);
  return { path, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), json, bin };
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Accessor values as a flat number array (normalized integer accessors are mapped to 0..1). */
function read(g: GlbFile, bufferView: number, byteOffset: number, componentType: number, normalized: boolean, size: number, count: number): number[] {
  const bv = g.json.bufferViews[bufferView];
  const dv = new DataView(g.bin.buffer, g.bin.byteOffset + (bv.byteOffset ?? 0) + byteOffset);
  const compBytes = componentType === 5126 || componentType === 5125 ? 4 : componentType === 5123 || componentType === 5122 ? 2 : 1;
  const stride = bv.byteStride ?? size * compBytes;
  const data: number[] = [];
  for (let i = 0; i < count; i++)
    for (let k = 0; k < size; k++) {
      const o = i * stride + k * compBytes;
      let v: number;
      switch (componentType) {
        case 5126: v = dv.getFloat32(o, true); break;
        case 5125: v = dv.getUint32(o, true); break;
        case 5123: v = dv.getUint16(o, true); if (normalized) v /= 65535; break;
        case 5121: v = dv.getUint8(o); if (normalized) v /= 255; break;
        default: throw new Error(`componentType ${componentType}`);
      }
      data.push(v);
    }
  return data;
}

/** Accessor values as a flat number array (normalized integer accessors mapped to 0..1; sparse accessors applied). */
export function accessor(g: GlbFile, index: number): { data: number[]; size: number; count: number } {
  const a = g.json.accessors[index];
  const size = COMPONENTS[a.type];
  const data = a.bufferView !== undefined ? read(g, a.bufferView, a.byteOffset ?? 0, a.componentType, !!a.normalized, size, a.count) : new Array<number>(a.count * size).fill(0);
  if (a.sparse) {
    const sp = a.sparse;
    const idx = read(g, sp.indices.bufferView, sp.indices.byteOffset ?? 0, sp.indices.componentType, false, 1, sp.count);
    const val = read(g, sp.values.bufferView, sp.values.byteOffset ?? 0, a.componentType, !!a.normalized, size, sp.count);
    idx.forEach((i, n) => {
      for (let k = 0; k < size; k++) data[i * size + k] = val[n * size + k];
    });
  }
  return { data, size, count: a.count };
}

/** Rest (node) world matrices of every node, and parent indices. */
export function nodeWorld(g: GlbFile): { world: THREE.Matrix4[]; parent: (number | undefined)[]; names: string[] } {
  const nodes = g.json.nodes as any[];
  const parent: (number | undefined)[] = nodes.map(() => undefined);
  nodes.forEach((n, i) => (n.children ?? []).forEach((c: number) => (parent[c] = i)));
  const local = nodes.map((n) =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(...(n.translation ?? [0, 0, 0])),
      new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
      new THREE.Vector3(...(n.scale ?? [1, 1, 1])),
    ),
  );
  const world: THREE.Matrix4[] = [];
  const W = (i: number): THREE.Matrix4 => {
    if (!world[i]) world[i] = parent[i] === undefined ? local[i].clone() : W(parent[i]!).clone().multiply(local[i]);
    return world[i];
  };
  nodes.forEach((_, i) => W(i));
  return { world, parent, names: nodes.map((n) => n.name as string) };
}

export interface Png {
  width: number;
  height: number;
  /** RGB bytes, row 0 = top. */
  rgb: Uint8Array;
}

/** Decode an embedded 8-bit non-interlaced RGB/RGBA PNG. */
export function decodePng(bytes: Uint8Array): Png {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;
  let width = 0;
  let height = 0;
  let ctype = 0;
  const idat: Uint8Array[] = [];
  while (p < bytes.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    const data = bytes.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = dv.getUint32(p + 8);
      height = dv.getUint32(p + 12);
      if (bytes[p + 16] !== 8 || bytes[p + 20] !== 0) throw new Error('PNG: only 8-bit non-interlaced');
      ctype = bytes[p + 17];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const bpp = ctype === 6 ? 4 : ctype === 2 ? 3 : 0;
  if (!bpp) throw new Error(`PNG colour type ${ctype}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = v & 255;
    }
  }
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) for (let k = 0; k < 3; k++) rgb[i * 3 + k] = out[i * bpp + k];
  return { width, height, rgb };
}

export function imagePng(g: GlbFile, imageIndex: number): Png {
  const im = g.json.images[imageIndex];
  const bv = g.json.bufferViews[im.bufferView];
  return decodePng(g.bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
}

/** Nearest-texel key colour (hex RRGGBB) at a glTF UV (origin top-left). */
export function texel(png: Png, u: number, v: number): string {
  const x = Math.min(png.width - 1, Math.max(0, Math.floor(u * png.width)));
  const y = Math.min(png.height - 1, Math.max(0, Math.floor(v * png.height)));
  const i = (y * png.width + x) * 3;
  return [png.rgb[i], png.rgb[i + 1], png.rgb[i + 2]].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}

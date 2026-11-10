// Plan 14: the run lab. On L3-F18-runLab the lab shows one player on the model running +X on the full L3 set, with a
// live speed slider and a keyframe editor for Fast Run (src/sim/clip-edit.ts).
//
// - Speed: a slider change appends a script segment at the simulation's current time to the lab's own copy of the
//   runner's script, so the request changes on the next tick. The lab caps the look-ahead (Playback.maxLeadTicks) so the
//   change reaches the shown run within a few ticks. The run lasts LAB_RUN.durationS on a long area and restarts at the
//   current speed (a running start) before its end.
// - Keyframes: pick a cycle frame and a joint, move its sliders. The ghost beside the runner shows the frame while the
//   slider moves (edited over original); on release the edit is committed, the clip goes through intake and the run
//   restarts at the current speed with the edited clip. An edit that fails intake is shown and not applied: the runner
//   keeps the last edits that passed.
// - Save writes models/animations/fast-run.edits.json through the dev server (vite.config.ts); copy puts the same text
//   on the clipboard. Only the run lab reads the file: the committed clip and every other fixture are unchanged.
import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import FAST_RUN from '../../models/animations/fast-run.json';
import { RUN_CLIPS_RECORD } from '../sim/model/run-clips';
import {
  addEdit,
  applyClipEdits,
  editedRunClip,
  editValue,
  EDIT_JOINTS,
  EDIT_LIMIT_DEG,
  frameOfPhase,
  frameStance,
  hashEdits,
  inPlaceFrame,
  normalizeEdits,
  parseClipEdits,
  type ClipEdit,
  type EditedClip,
  type EditJoint,
} from '../sim/clip-edit';
import { runLab, RUN_LAB_ID } from '../sim/fixtures/transitions';
import type { FixtureDef } from '../sim/fixture';
import type { Simulation } from '../sim/simulation';
import type { ScriptSegment, ScriptSpec } from '../sim/controllers/base';
import { playbackLabel, type RunClipAnalysis, type RunClipProfile } from '../sim/run-clip';
import type { ArmSide } from '../sim/contracts';
import { v3, type Vec3 } from '../sim/vec';
import type { Playback } from './playback';

const CLIP = 'fast-run';
const ENDPOINT = '/__lab/clip-edits';
/** The lab's run: a long area, a restart before its end, the speed range, the look-ahead cap (ticks). */
export const LAB_RUN = { durationS: 60, halfX: 400, startX: 0, restartX: 350, maxSpeedMps: 6.6, leadTicks: 3 };
/** Ghost placement from the runner's COM (world m): ahead and to the side, clear of the side and front cameras. */
const GHOST_OFFSET = v3(1.6, 0, -0.9);

/** Ghost skeleton segments (clip joint names). */
const BONES: [string, string][] = [
  ['Hips', 'Spine'],
  ['Spine', 'Spine1'],
  ['Spine1', 'Spine2'],
  ['Spine2', 'Neck'],
  ['Neck', 'Head'],
  ['Head', 'HeadTop_End'],
  ...(['Left', 'Right'] as const).flatMap((S): [string, string][] => [
    ['Spine2', `${S}Shoulder`],
    [`${S}Shoulder`, `${S}Arm`],
    [`${S}Arm`, `${S}ForeArm`],
    [`${S}ForeArm`, `${S}Hand`],
    [`${S}Hand`, `${S}HandIndex1`],
    ['Hips', `${S}UpLeg`],
    [`${S}UpLeg`, `${S}Leg`],
    [`${S}Leg`, `${S}Foot`],
    [`${S}Foot`, `${S}ToeBase`],
    [`${S}ToeBase`, `${S}Toe_End`],
  ]),
];

/** Clip joint each editable joint turns about. */
const PIVOT: Record<EditJoint, string> = { hip: 'UpLeg', knee: 'Leg', ankle: 'Foot', shoulder: 'Arm', elbow: 'ForeArm' };
const CAP: Record<ArmSide, string> = { left: 'Left', right: 'Right' };

/** Stick skeleton of one clip frame: the edited frame (thick, accent) over the original (thin, dark), the edited joint marked. */
class Ghost {
  readonly root = new THREE.Group();
  private readonly edited: LineSegments2;
  private readonly original: LineSegments2;
  private readonly mark: THREE.Mesh;

  constructor() {
    const lines = (color: number, widthPx: number, opacity: number, order: number): LineSegments2 => {
      const m = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color, linewidth: widthPx, transparent: true, opacity }));
      m.frustumCulled = false;
      m.renderOrder = order;
      return m;
    };
    // both transparent, drawn in order: the edited lines over the original where they coincide
    this.original = lines(0x18212b, 2, 0.7, 1);
    this.edited = lines(0xf2c14e, 3.5, 1, 2);
    this.mark = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff7a45 }));
    this.mark.renderOrder = 3;
    this.root.add(this.original, this.edited, this.mark);
  }

  set(edited: Record<string, Vec3>, original: Record<string, Vec3>, pivot: string, scale: number): void {
    const fill = (l: LineSegments2, f: Record<string, Vec3>): void => {
      const a = new Float32Array(BONES.length * 6);
      BONES.forEach(([p, q], i) => {
        const A = f[p] ?? f.Hips;
        const B = f[q] ?? A;
        a.set([A.x * scale, A.y * scale, A.z * scale, B.x * scale, B.y * scale, B.z * scale], 6 * i);
      });
      l.geometry.setPositions(a);
    };
    fill(this.edited, edited);
    fill(this.original, original);
    const m = edited[pivot];
    if (m) this.mark.position.set(m.x * scale, m.y * scale, m.z * scale);
  }

  /** Line widths are in pixels: the materials need the drawing size. */
  resize(w: number, h: number): void {
    for (const l of [this.edited, this.original]) (l.material as LineMaterial).resolution.set(w, h);
  }

  /** Beside the runner's COM, facing +X (the clip's +Z travel turned onto the run). */
  place(com: Vec3): void {
    this.root.position.set(com.x + GHOST_OFFSET.x, 0, com.z + GHOST_OFFSET.z);
    this.root.rotation.y = Math.PI / 2;
  }
}

interface Sel {
  side: ArmSide;
  joint: EditJoint;
}

const f2 = (x: number, d = 2): string => x.toFixed(d);

export class RunLab {
  private readonly rec = RUN_CLIPS_RECORD.clips.find((c) => c.id === CLIP)!;
  private readonly original: EditedClip = editedRunClip(this.rec, FAST_RUN, []);
  /** Committed edits, and the edits of the clip the runner plays (the last that passed intake). */
  private edits: ClipEdit[] = [];
  private applied: ClipEdit[] = [];
  private current: EditedClip = this.original;
  private error: string | null = null;
  private history: ClipEdit[][] = [];
  /** Text of the edits as last saved or read from the file (unsaved changes differ from it). */
  private savedText: string | null = null;
  private fileNote = '';
  private loading: Promise<void> | null = null;
  private speed = 5;
  private ball = false;
  private frameSel = 4;
  private sel: Sel = { side: 'left', joint: 'knee' };
  private spread: 0 | 1 | 2 = 1;
  /** Edits shown by the ghost while a slider moves (not yet committed). */
  private preview: ClipEdit[] | null = null;
  private sim: Simulation | null = null;
  private playback: Playback<unknown> | null = null;
  private segments: ScriptSegment[] | null = null;
  private wasPlaying = false;
  /** A restart is loading (frame() waits for its attach). */
  private restarting = false;
  private shownFrame = -1;
  private readonly ghost = new Ghost();
  private ghostOn = true;
  active = false;

  constructor(
    private readonly scene: THREE.Scene,
    /** Reload the run lab fixture (load(RUN_LAB_ID) in main.ts: it calls prepare and attach). */
    private readonly reload: () => void,
  ) {
    this.buildUi();
  }

  handles(def: FixtureDef): boolean {
    return def.id === RUN_LAB_ID;
  }

  /** The lab's run of the fixture: its run-clip profile (as tuned) with the edited Fast Run, the current speed and ball. */
  async prepare(def: FixtureDef): Promise<FixtureDef> {
    this.loading ??= this.readFile();
    await this.loading;
    const P = def.runClips!;
    const runClips: RunClipProfile = this.applied.length
      ? { ...P, id: `${P.id}+edit(${hashEdits(this.applied)})`, clips: P.clips.map((c) => (c.id === CLIP ? this.current.clip : c)) }
      : P;
    return runLab({ speedMps: this.speed, durationS: LAB_RUN.durationS, startX: LAB_RUN.startX, halfX: LAB_RUN.halfX, ball: this.ball, runClips });
  }

  /** The simulation and playback main.ts built from `prepare`'s fixture. */
  attach(sim: Simulation, playback: Playback<unknown>): void {
    this.sim = sim;
    this.playback = playback;
    playback.maxLeadTicks = LAB_RUN.leadTicks;
    if (this.wasPlaying) playback.paused = false;
    const c = sim.def.players[0].controller as ScriptSpec;
    this.segments = c.segments;
    this.restarting = false;
    // a speed change while this run was being built
    if (c.segments[0].velocity.x !== this.speed) this.setSpeed(this.speed);
    if (!this.active) this.scene.add(this.ghost.root);
    this.active = true;
    this.shownFrame = -1;
    el('runlab').hidden = false;
    this.render();
  }

  detach(): void {
    if (this.active) this.scene.remove(this.ghost.root);
    this.active = false;
    this.sim = null;
    this.playback = null;
    this.segments = null;
    this.restarting = false;
    this.wasPlaying = false;
    el('runlab').hidden = true;
  }

  /** Start the run again at the current speed (keeps playing if it was). */
  restart(playing = !!this.playback && !this.playback.paused): void {
    this.wasPlaying = playing;
    this.restarting = true;
    this.reload();
  }

  /** Per display frame: place the ghost at the shown runner, restart before the run's end, refresh the live line. */
  frame(com: Vec3): void {
    if (!this.active || !this.sim || !this.playback || this.restarting) return;
    this.ghost.root.visible = this.ghostOn;
    this.ghost.resize(window.innerWidth, window.innerHeight);
    this.ghost.place(com);
    // the end of the run (playback paused itself there) or the end of the area: run again from the start
    if (this.playback.ended || com.x > LAB_RUN.restartX) {
      this.restart(true);
      return;
    }
    const pl = this.sim.players[0];
    const st = pl.run;
    const P = this.sim.def.runClips;
    const lines = [`request ${f2(this.speed, 1)} m/s`];
    if (st && P) {
      const clip = st.w > 0 ? playbackLabel(st, P) : 'procedural gait';
      lines.push(`actual ${f2(st.speed)} m/s`, clip, `rate ${f2(st.rate)}`, `stride ${f2(st.share ?? 1)}`);
      const k = clip.endsWith(CLIP) ? frameOfPhase(this.current.analysis, st.u + (st.uSlip ?? 0)) : -1;
      if (k !== this.shownFrame) {
        this.shownFrame = k;
        this.markFrames();
      }
    }
    el('rlLive').textContent = lines.join(' · ');
  }

  // ------------------------------------------------------------------------------------------- speed
  setSpeed(v: number): void {
    this.speed = Math.max(0, Math.min(LAB_RUN.maxSpeedMps, v));
    (el('rlSpeed') as HTMLInputElement).value = String(this.speed);
    el('rlSpeedOut').textContent = `${f2(this.speed, 1)} m/s`;
    if (this.sim && this.segments && !this.sim.done) this.segments.push({ fromS: this.sim.t, velocity: v3(this.speed, 0, 0), facing: v3(1, 0, 0), effort: 1 });
  }

  // ------------------------------------------------------------------------------------------- edits
  /** Commit an edit list: re-run intake; on success restart with the edited clip, else show why and keep the last. */
  private commit(next: ClipEdit[]): void {
    this.history.push(this.edits);
    if (this.history.length > 200) this.history.shift();
    this.setEdits(next);
  }

  private setEdits(next: ClipEdit[]): void {
    this.edits = normalizeEdits(next);
    this.preview = null;
    const ok = this.rebuild();
    this.render();
    if (ok && this.active) this.restart();
  }

  private rebuild(): boolean {
    try {
      this.current = this.edits.length ? editedRunClip(this.rec, FAST_RUN, this.edits) : this.original;
      this.applied = this.edits;
      this.error = null;
      return true;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  undo(): void {
    const prev = this.history.pop();
    if (prev) this.setEdits(prev);
  }

  /** Text of the edits file (one edit per line). */
  fileText(): string {
    const head = { version: 1, clip: CLIP, baseDataSha256: this.rec.dataSha256 };
    const body = this.edits.map((e) => `  ${JSON.stringify(e)}`).join(',\n');
    return `${JSON.stringify(head, null, 1).replace(/\n}$/, ',')}\n "edits": [${this.edits.length ? `\n${body}\n ` : ''}]\n}\n`;
  }

  private async readFile(): Promise<void> {
    try {
      const r = await fetch(ENDPOINT);
      if (r.status === 404) {
        this.savedText = this.fileText();
        this.fileNote = 'no edits file yet';
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      const f = parseClipEdits(CLIP, JSON.parse(text));
      if (f.baseDataSha256 !== this.rec.dataSha256) {
        this.fileNote = `edits file is for another Fast Run bake (${f.baseDataSha256.slice(0, 12)}); not applied`;
        return;
      }
      this.edits = f.edits;
      this.rebuild();
      this.savedText = this.fileText();
      this.fileNote = `read ${f.edits.length} edit(s) from models/animations/fast-run.edits.json`;
    } catch (e) {
      this.fileNote = `edits file not read (${e instanceof Error ? e.message : String(e)})`;
    }
  }

  async save(): Promise<void> {
    const text = this.fileText();
    try {
      const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: text });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      this.savedText = text;
      this.fileNote = `saved ${this.edits.length} edit(s) to models/animations/fast-run.edits.json`;
    } catch (e) {
      this.fileNote = `save failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    this.render();
  }

  // ------------------------------------------------------------------------------------------- UI
  private at(channel: 'flex' | 'abduct'): Pick<ClipEdit, 'frame' | 'side' | 'joint' | 'channel'> {
    return { frame: this.frameSel, side: this.sel.side, joint: this.sel.joint, channel };
  }

  private buildUi(): void {
    const speed = el('rlSpeed') as HTMLInputElement;
    speed.max = String(LAB_RUN.maxSpeedMps);
    speed.value = String(this.speed);
    el('rlSpeedOut').textContent = `${f2(this.speed, 1)} m/s`;
    speed.oninput = () => this.setSpeed(Number(speed.value));
    const ball = el('rlBall') as HTMLInputElement;
    ball.onchange = () => {
      this.ball = ball.checked;
      if (this.active) this.restart();
    };
    const ghost = el('rlGhost') as HTMLInputElement;
    ghost.checked = this.ghostOn;
    ghost.onchange = () => (this.ghostOn = ghost.checked);
    const frames = el('rlFrames');
    for (let i = 0; i < this.rec.cycleFrames; i++) {
      const b = document.createElement('button');
      b.textContent = String(i);
      b.dataset.frame = String(i);
      b.onclick = () => this.selectFrame(i);
      frames.append(b);
    }
    el('rlPrev').onclick = () => this.selectFrame((this.frameSel + this.rec.cycleFrames - 1) % this.rec.cycleFrames);
    el('rlNext').onclick = () => this.selectFrame((this.frameSel + 1) % this.rec.cycleFrames);
    const joint = el('rlJoint') as HTMLSelectElement;
    for (const side of ['left', 'right'] as ArmSide[])
      for (const j of EDIT_JOINTS) {
        const o = document.createElement('option');
        o.value = `${side}:${j.joint}`;
        o.textContent = `${side} ${j.label}`;
        joint.append(o);
      }
    joint.value = `${this.sel.side}:${this.sel.joint}`;
    joint.onchange = () => {
      const [side, j] = joint.value.split(':') as [ArmSide, EditJoint];
      this.sel = { side, joint: j };
      this.render();
    };
    const spread = el('rlSpread') as HTMLSelectElement;
    spread.value = String(this.spread);
    spread.onchange = () => (this.spread = Number(spread.value) as 0 | 1 | 2);
    el('rlUndo').onclick = () => this.undo();
    el('rlResetFrame').onclick = () => this.commit(this.edits.filter((e) => e.frame !== this.frameSel));
    el('rlResetAll').onclick = () => this.commit([]);
    el('rlSave').onclick = () => void this.save();
    el('rlCopy').onclick = () => void navigator.clipboard?.writeText(this.fileText());
  }

  selectFrame(i: number): void {
    this.frameSel = i;
    this.render();
  }

  /** Stance tint, selection, edited and runner-frame marks on the frame strip. */
  private markFrames(): void {
    const a: RunClipAnalysis = this.current.analysis;
    const s = frameStance(a, this.frameSel);
    const feet = s.left && s.right ? 'both feet down' : s.left ? 'left foot down' : s.right ? 'right foot down' : 'flight';
    el('rlFrameInfo').textContent = `${this.frameSel} of ${a.cycleFrames} (${((this.frameSel / a.cycleFrames) * a.cycleS * 1000).toFixed(0)} ms) · ${feet}`;
    const edited = new Set(this.edits.map((e) => e.frame));
    el('rlFrames')
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((b) => {
        const i = Number(b.dataset.frame);
        const s = frameStance(a, i);
        b.className = [s.left ? 'stL' : '', s.right ? 'stR' : '', i === this.frameSel ? 'on' : '', i === this.shownFrame ? 'cur' : '', edited.has(i) ? 'ed' : ''].filter(Boolean).join(' ');
      });
  }

  private render(): void {
    this.markFrames();
    const rows = el('rlRows');
    rows.textContent = '';
    const J = EDIT_JOINTS.find((j) => j.joint === this.sel.joint)!;
    for (const ch of J.channels) {
      const at = this.at(ch.channel);
      const cur = editValue(this.edits, at);
      const row = document.createElement('div');
      const lab = document.createElement('label');
      const val = document.createElement('span');
      const inp = document.createElement('input');
      inp.type = 'range';
      inp.min = String(-EDIT_LIMIT_DEG);
      inp.max = String(EDIT_LIMIT_DEG);
      inp.step = '0.5';
      inp.value = String(cur);
      lab.textContent = `${ch.channel} (+ ${ch.positive}) `;
      const show = (x: number): void => void (val.textContent = ` ${x >= 0 ? '+' : ''}${f2(x, 1)}°`);
      show(cur);
      inp.oninput = () => {
        const x = Number(inp.value);
        show(x);
        this.preview = addEdit(this.edits, at, x - cur, this.spread, this.rec.cycleFrames);
        this.drawGhost();
      };
      inp.onchange = () => this.commit(addEdit(this.edits, at, Number(inp.value) - cur, this.spread, this.rec.cycleFrames));
      row.append(lab, inp, val);
      rows.append(row);
    }
    const o = this.original.analysis;
    const c = this.current.analysis;
    const pair = (x: number, y: number, d = 2): string => (Math.abs(x - y) < 10 ** -(d + 1) ? f2(x, d) : `${f2(x, d)} → ${f2(y, d)}`);
    const st = (s: [number, number]): string => `${f2(s[0], 3)}–${f2(s[1], 3)}`;
    const stPair = (x: [number, number], y: [number, number]): string => (st(x) === st(y) ? st(x) : `${st(x)} → ${st(y)}`);
    el('rlAnalysis').textContent = [
      `nominal ${pair(o.nominalSpeedMps, c.nominalSpeedMps)} m/s · stride ${pair(o.strideM, c.strideM)} m · flight ${pair(o.flightFraction, c.flightFraction, 3)}`,
      `stance L ${stPair(o.stance.left, c.stance.left)} · R ${stPair(o.stance.right, c.stance.right)}`,
      `${this.applied.length} edit(s) playing${this.edits.length !== this.applied.length || this.error ? `, ${this.edits.length} committed` : ''}`,
    ].join('\n');
    const err = el('rlError');
    err.textContent = this.error ? `edit not applied (intake): ${this.error}` : '';
    err.hidden = !this.error;
    const unsaved = this.savedText !== null && this.savedText !== this.fileText();
    el('rlStatus').textContent = `${unsaved ? 'unsaved changes · ' : ''}${this.fileNote}`;
    (el('rlUndo') as HTMLButtonElement).disabled = this.history.length === 0;
    this.drawGhost();
  }

  private drawGhost(): void {
    const data = applyClipEdits(CLIP, FAST_RUN, this.preview ?? this.edits);
    const a = this.current.analysis;
    const S = CAP[this.sel.side];
    this.ghost.set(inPlaceFrame(data, a, this.frameSel), inPlaceFrame(this.original.data, this.original.analysis, this.frameSel), `${S}${PIVOT[this.sel.joint]}`, this.rec.playerLegScale);
  }

  /** Scripted inspection (window.lab.runLab): the state an automated check reads. */
  get state(): { speed: number; edits: ClipEdit[]; applied: number; error: string | null; frame: number; shownFrame: number; nominalSpeedMps: number } {
    return { speed: this.speed, edits: this.edits, applied: this.applied.length, error: this.error, frame: this.frameSel, shownFrame: this.shownFrame, nominalSpeedMps: this.current.analysis.nominalSpeedMps };
  }

  /** Scripted edit (window.lab.runLab.edit): as a slider release on the given frame and joint. */
  edit(frame: number, side: ArmSide, joint: EditJoint, channel: 'flex' | 'abduct', deg: number, spread: 0 | 1 | 2 = 0): void {
    this.frameSel = frame;
    this.sel = { side, joint };
    (el('rlJoint') as HTMLSelectElement).value = `${side}:${joint}`;
    this.commit(addEdit(this.edits, { frame, side, joint, channel }, deg - editValue(this.edits, { frame, side, joint, channel }), spread, this.rec.cycleFrames));
  }
}

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

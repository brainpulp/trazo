import * as THREE from 'three';
import { buildRibbon, buildTube, type MeshData } from './strokeGeometry';

export type Brush = 'tube' | 'ribbon';

export interface StrokeData {
  id: string;
  brush: Brush;
  color: string;
  /** Flat xyz list in world space. */
  pts: number[];
  radii: number[];
  /** Drawing-plane normal, used to orient ribbons. */
  normal: [number, number, number];
}

type Action =
  | { type: 'add'; strokes: StrokeData[] }
  | { type: 'remove'; strokes: StrokeData[] };

const STORAGE_KEY = 'trazo.sketch.v1';

let idCounter = 0;
export const newId = () => `s${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export function meshDataFor(s: StrokeData): MeshData | null {
  return s.brush === 'ribbon'
    ? buildRibbon(s.pts, s.radii, s.normal)
    : buildTube(s.pts, s.radii, tubeSegments(s.radii));
}

function tubeSegments(radii: number[]) {
  // thicker strokes get rounder tubes
  const maxR = radii.reduce((m, r) => Math.max(m, r), 0);
  return maxR > 0.03 ? 14 : maxR > 0.01 ? 10 : 7;
}

export function applyMeshData(geom: THREE.BufferGeometry, data: MeshData | null) {
  if (!data) {
    geom.setIndex(null);
    geom.deleteAttribute('position');
    geom.deleteAttribute('normal');
    geom.setDrawRange(0, 0);
    return;
  }
  geom.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geom.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geom.setDrawRange(0, Infinity);
  geom.computeBoundingSphere();
  geom.computeBoundingBox();
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>();
export function materialFor(color: string, brush: Brush) {
  const key = `${color}|${brush}`;
  let m = materialCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.55,
      metalness: 0.0,
      side: brush === 'ribbon' ? THREE.DoubleSide : THREE.FrontSide,
    });
    m.name = `trazo-${color.replace('#', '')}`;
    materialCache.set(key, m);
  }
  return m;
}

/** Owns all committed strokes, their meshes, undo/redo history and persistence. */
export class Sketch {
  readonly group = new THREE.Group();
  private strokes = new Map<string, { data: StrokeData; mesh: THREE.Mesh }>();
  private undoStack: Action[] = [];
  private redoStack: Action[] = [];
  private saveTimer = 0;
  onChange: () => void = () => {};

  constructor() {
    this.group.name = 'trazo';
  }

  get count() {
    return this.strokes.size;
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  meshes(): THREE.Mesh[] {
    return [...this.strokes.values()].map((s) => s.mesh);
  }

  strokeIdOf(obj: THREE.Object3D): string | undefined {
    return obj.userData.strokeId as string | undefined;
  }

  add(strokes: StrokeData[]) {
    if (!strokes.length) return;
    strokes.forEach((s) => this.insert(s));
    this.push({ type: 'add', strokes });
  }

  remove(ids: string[]) {
    const removed: StrokeData[] = [];
    for (const id of ids) {
      const s = this.strokes.get(id);
      if (s) {
        removed.push(s.data);
        this.delete(id);
      }
    }
    if (removed.length) this.push({ type: 'remove', strokes: removed });
  }

  clear() {
    this.remove([...this.strokes.keys()]);
  }

  undo() {
    const a = this.undoStack.pop();
    if (!a) return;
    this.apply(a, true);
    this.redoStack.push(a);
    this.changed();
  }

  redo() {
    const a = this.redoStack.pop();
    if (!a) return;
    this.apply(a, false);
    this.undoStack.push(a);
    this.changed();
  }

  toJSON() {
    return { version: 1, strokes: [...this.strokes.values()].map((s) => s.data) };
  }

  load(json: unknown) {
    const strokes = (json as { strokes?: StrokeData[] })?.strokes;
    if (!Array.isArray(strokes)) return;
    for (const id of [...this.strokes.keys()]) this.delete(id);
    for (const s of strokes) {
      if (Array.isArray(s?.pts) && Array.isArray(s?.radii)) this.insert(s);
    }
    this.undoStack = [];
    this.redoStack = [];
    this.onChange();
  }

  restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.load(JSON.parse(raw));
    } catch {
      /* storage unavailable or corrupt: start empty */
    }
  }

  private apply(a: Action, inverse: boolean) {
    const adding = (a.type === 'add') !== inverse;
    for (const s of a.strokes) {
      if (adding) this.insert(s);
      else this.delete(s.id);
    }
  }

  private push(a: Action) {
    this.undoStack.push(a);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.changed();
  }

  private changed() {
    this.onChange();
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.toJSON()));
      } catch {
        /* quota or private mode: ignore */
      }
    }, 400);
  }

  private insert(s: StrokeData) {
    if (this.strokes.has(s.id)) return;
    const geom = new THREE.BufferGeometry();
    applyMeshData(geom, meshDataFor(s));
    const mesh = new THREE.Mesh(geom, materialFor(s.color, s.brush));
    mesh.userData.strokeId = s.id;
    mesh.name = s.id;
    this.group.add(mesh);
    this.strokes.set(s.id, { data: s, mesh });
  }

  private delete(id: string) {
    const s = this.strokes.get(id);
    if (!s) return;
    this.group.remove(s.mesh);
    s.mesh.geometry.dispose();
    this.strokes.delete(id);
  }
}

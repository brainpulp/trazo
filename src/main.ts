import './style.css';
import * as THREE from 'three';
import { Orbit } from './orbit';
import { Sketch, applyMeshData, materialFor, meshDataFor, newId, type Brush, type StrokeData } from './sketch';
import { mirrorX, pressureToScale } from './strokeGeometry';

type Tool = 'draw' | 'erase';
type PlaneMode = 'view' | 'xy' | 'yz' | 'xz' | 'surface';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

// ---------- scene ----------
const canvas = $<HTMLCanvasElement>('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x16171b);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x16171b, 8, 30);
const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 200);
const orbit = new Orbit(camera);

scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3d46, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(2, 4, 3);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xbcd2ff, 0.5);
fill.position.set(-3, 1, -2);
scene.add(fill);

const floor = new THREE.Group();
const floorGrid = new THREE.GridHelper(6, 30, 0x3b3f4a, 0x262930);
floor.add(floorGrid);
const axisX = new THREE.Mesh(new THREE.BoxGeometry(6, 0.002, 0.002), new THREE.MeshBasicMaterial({ color: 0x8a3b3b }));
const axisZ = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.002, 6), new THREE.MeshBasicMaterial({ color: 0x3b5a8a }));
floor.add(axisX, axisZ);
scene.add(floor);

const sketch = new Sketch();
scene.add(sketch.group);

// Drawing-plane visual
const planeVis = new THREE.Group();
const planeGrid = new THREE.GridHelper(1, 20, 0x7aa2ff, 0x7aa2ff);
(planeGrid.material as THREE.Material).transparent = true;
(planeGrid.material as THREE.Material).depthWrite = false;
const planeFill = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x7aa2ff, transparent: true, opacity: 0.04, side: THREE.DoubleSide, depthWrite: false }),
);
planeVis.add(planeGrid, planeFill);
planeVis.renderOrder = 10;
scene.add(planeVis);

// Mirror plane visual
const mirrorVis = new THREE.Mesh(
  new THREE.PlaneGeometry(4, 4).rotateY(Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xff7ab8, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false }),
);
mirrorVis.position.y = 1;
mirrorVis.visible = false;
scene.add(mirrorVis);

// 3D cursor (pen hover / mouse)
const cursor = new THREE.Mesh(
  new THREE.SphereGeometry(1, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false }),
);
cursor.renderOrder = 20;
cursor.visible = false;
scene.add(cursor);

// ---------- state ----------
const PALETTE = ['#f2f2f2', '#1d1d1f', '#ff5a5f', '#ffb020', '#ffe14d', '#3ddc84', '#28c2ff', '#4f6bff', '#b05cff', '#ff7ab8'];
const state = {
  tool: 'draw' as Tool,
  brush: 'tube' as Brush,
  color: PALETTE[6],
  sizePx: 6,
  smooth: 0.45,
  plane: 'view' as PlaneMode,
  depth: 0,
  mirror: false,
  anchor: true,
  locked: null as null | { normal: THREE.Vector3; base: THREE.Vector3 },
  fingerDraw: false,
};

let needsRender = true;
const requestRender = () => (needsRender = true);

// ---------- drawing plane ----------
function forward() {
  return camera.getWorldDirection(new THREE.Vector3());
}

function currentPlane(): { normal: THREE.Vector3; origin: THREE.Vector3 } {
  if (state.locked) {
    const { normal, base } = state.locked;
    return { normal: normal.clone(), origin: base.clone().addScaledVector(normal, state.depth) };
  }
  switch (state.plane) {
    case 'xy':
      return { normal: new THREE.Vector3(0, 0, 1), origin: new THREE.Vector3(0, 0, state.depth) };
    case 'yz':
      return { normal: new THREE.Vector3(1, 0, 0), origin: new THREE.Vector3(state.depth, 0, 0) };
    case 'xz':
      return { normal: new THREE.Vector3(0, 1, 0), origin: new THREE.Vector3(0, state.depth, 0) };
    default: {
      const f = forward();
      return { normal: f.clone().negate(), origin: orbit.target.clone().addScaledVector(f, state.depth) };
    }
  }
}

/** Moves the active plane so it passes through `p` (keeping its orientation). */
function movePlaneThrough(p: THREE.Vector3) {
  const { normal, origin } = currentPlane();
  const delta = p.clone().sub(origin).dot(normal);
  setDepth(state.depth + (state.plane === 'view' && !state.locked ? -delta : delta));
}

function updatePlaneVis(active: boolean) {
  const { normal, origin } = currentPlane();
  const t = orbit.target;
  const center = t.clone().addScaledVector(normal, -t.clone().sub(origin).dot(normal));
  planeVis.position.copy(center);
  planeVis.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
  planeVis.scale.setScalar(Math.max(0.5, orbit.radius * 1.4));
  (planeGrid.material as THREE.LineBasicMaterial).opacity = active ? 0.35 : state.plane === 'view' && !state.locked ? 0.07 : 0.18;
  planeVis.visible = state.plane !== 'surface' || !!state.locked;
}

// ---------- picking ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function rayAt(x: number, y: number) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray;
}

function pickStroke(x: number, y: number) {
  rayAt(x, y);
  const hits = raycaster.intersectObjects(sketch.meshes(), false);
  return hits[0];
}

function planePoint(x: number, y: number, normal: THREE.Vector3, origin: THREE.Vector3) {
  const ray = rayAt(x, y);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
  const p = ray.intersectPlane(plane, new THREE.Vector3());
  if (p) return p;
  // ray parallel to plane / behind: fall back to closest point on the ray at target distance
  return ray.at(orbit.radius, new THREE.Vector3());
}

function radiusForDepth(p: THREE.Vector3) {
  const depth = p.clone().sub(camera.position).dot(forward());
  return state.sizePx * 0.5 * orbit.worldPerPixel(Math.max(depth, 0.01), canvas.clientHeight);
}

// ---------- live stroke ----------
interface Live {
  pointerId: number;
  pointerType: string;
  normal: THREE.Vector3;
  origin: THREE.Vector3;
  baseRadius: number;
  data: StrokeData;
  mesh: THREE.Mesh;
  mirror?: { data: StrokeData; mesh: THREE.Mesh };
  last: THREE.Vector3 | null;
  smoothed: THREE.Vector3 | null;
  dirty: boolean;
}
let live: Live | null = null;
let erasing: { pointerId: number; ids: Set<string> } | null = null;

function makeLiveMesh(data: StrokeData) {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), materialFor(data.color, data.brush));
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

function beginStroke(e: PointerEvent) {
  let plane = currentPlane();
  if (state.anchor || state.plane === 'surface') {
    const hit = pickStroke(e.clientX, e.clientY);
    if (hit && state.anchor && state.plane !== 'surface') {
      movePlaneThrough(hit.point);
      plane = currentPlane();
    }
  }
  const startP = planePoint(e.clientX, e.clientY, plane.normal, plane.origin);
  const data: StrokeData = {
    id: newId(),
    brush: state.brush,
    color: state.color,
    pts: [],
    radii: [],
    normal: [plane.normal.x, plane.normal.y, plane.normal.z],
  };
  live = {
    pointerId: e.pointerId,
    pointerType: e.pointerType,
    normal: plane.normal,
    origin: plane.origin,
    baseRadius: radiusForDepth(startP),
    data,
    mesh: makeLiveMesh(data),
    last: null,
    smoothed: null,
    dirty: true,
  };
  if (state.mirror) {
    const md: StrokeData = { ...data, id: newId(), pts: [], radii: [], normal: [-plane.normal.x, plane.normal.y, plane.normal.z] };
    live.mirror = { data: md, mesh: makeLiveMesh(md) };
  }
  extendStroke(e);
  updatePlaneVis(true);
}

function surfacePoint(x: number, y: number, radius: number): THREE.Vector3 | null {
  const hit = pickStroke(x, y);
  if (!hit) return null;
  const n = hit.face ? hit.face.normal.clone() : forward().negate();
  return hit.point.clone().addScaledVector(n, radius * 0.9);
}

function extendStroke(e: PointerEvent) {
  if (!live) return;
  const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
  const list = events.length ? events : [e];
  for (const ev of list) {
    const r = live.baseRadius * pressureToScale(ev.pressure, live.pointerType);
    let p =
      state.plane === 'surface' && !state.locked
        ? surfacePoint(ev.clientX, ev.clientY, r) ?? planePoint(ev.clientX, ev.clientY, live.normal, live.origin)
        : planePoint(ev.clientX, ev.clientY, live.normal, live.origin);
    if (!live.smoothed) live.smoothed = p.clone();
    else live.smoothed.lerp(p, 1 - state.smooth);
    p = live.smoothed;
    const minStep = Math.max(live.baseRadius * 0.35, 1e-4);
    if (live.last && live.last.distanceTo(p) < minStep) {
      // update the thickness of the tip while the pen rests
      const rs = live.data.radii;
      if (rs.length) rs[rs.length - 1] = Math.max(rs[rs.length - 1], r);
      continue;
    }
    live.last = p.clone();
    live.data.pts.push(p.x, p.y, p.z);
    live.data.radii.push(r);
    if (live.mirror) {
      live.mirror.data.pts.push(-p.x, p.y, p.z);
      live.mirror.data.radii.push(r);
    }
  }
  live.dirty = true;
  requestRender();
}

function finishStroke(cancel = false) {
  if (!live) return;
  const l = live;
  live = null;
  for (const m of [l.mesh, l.mirror?.mesh]) {
    if (!m) continue;
    scene.remove(m);
    m.geometry.dispose();
  }
  if (!cancel && l.data.pts.length) {
    const strokes = [l.data];
    if (l.mirror) strokes.push({ ...l.mirror.data, pts: mirrorX(l.data.pts), radii: [...l.data.radii] });
    sketch.add(strokes);
  }
  updatePlaneVis(false);
  requestRender();
}

function eraseAt(x: number, y: number) {
  const hit = pickStroke(x, y);
  if (!hit || !erasing) return;
  const id = sketch.strokeIdOf(hit.object);
  if (id && !erasing.ids.has(id)) {
    erasing.ids.add(id);
    hit.object.visible = false;
    requestRender();
  }
}

// ---------- pointer input ----------
const touches = new Map<number, { x: number; y: number }>();
let gesture = { startTime: 0, maxTouches: 0, moved: 0, lastCentroid: { x: 0, y: 0 }, lastDist: 0 };
let mouseNav: { button: number; x: number; y: number; pan: boolean } | null = null;

function isDrawingPointer(e: PointerEvent) {
  if (e.pointerType === 'pen') return true;
  if (e.pointerType === 'mouse') return e.button === 0 && !e.altKey;
  return state.fingerDraw && touches.size === 0;
}

function centroid() {
  let x = 0;
  let y = 0;
  touches.forEach((t) => ((x += t.x), (y += t.y)));
  return { x: x / touches.size, y: y / touches.size };
}
function spread() {
  const pts = [...touches.values()];
  if (pts.length < 2) return 0;
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
}
function resetGestureBaseline() {
  gesture.lastCentroid = centroid();
  gesture.lastDist = spread();
}

function capture(e: PointerEvent) {
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* synthetic or already-released pointer */
  }
}

canvas.addEventListener('pointerdown', (e) => {
  closeMenu();
  if (live || erasing) {
    // palm or second finger while drawing
    if (live && e.pointerType === 'touch' && live.pointerType === 'touch') {
      finishStroke(true); // a second finger means "navigate", not "draw"
    } else return;
  }
  if (e.pointerType !== 'touch' && isDrawingPointer(e)) {
    capture(e);
    cursor.visible = false;
    if (state.tool === 'erase') {
      erasing = { pointerId: e.pointerId, ids: new Set() };
      eraseAt(e.clientX, e.clientY);
    } else beginStroke(e);
    return;
  }
  if (e.pointerType === 'mouse') {
    capture(e);
    mouseNav = { button: e.button, x: e.clientX, y: e.clientY, pan: e.button === 1 || e.shiftKey };
    return;
  }
  // touch
  capture(e);
  if (touches.size === 0) gesture = { startTime: performance.now(), maxTouches: 0, moved: 0, lastCentroid: { x: 0, y: 0 }, lastDist: 0 };
  const fingerStroke = state.fingerDraw && touches.size === 0;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  gesture.maxTouches = Math.max(gesture.maxTouches, touches.size);
  resetGestureBaseline();
  if (fingerStroke) {
    if (state.tool === 'erase') {
      erasing = { pointerId: e.pointerId, ids: new Set() };
      eraseAt(e.clientX, e.clientY);
    } else beginStroke(e);
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (live && e.pointerId === live.pointerId) {
    extendStroke(e);
    if (live?.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    return;
  }
  if (erasing && e.pointerId === erasing.pointerId) {
    eraseAt(e.clientX, e.clientY);
    return;
  }
  if (mouseNav) {
    const dx = e.clientX - mouseNav.x;
    const dy = e.clientY - mouseNav.y;
    mouseNav.x = e.clientX;
    mouseNav.y = e.clientY;
    if (mouseNav.pan || e.shiftKey) orbit.pan(dx, dy, canvas.clientHeight);
    else orbit.rotate(dx * 0.008, dy * 0.008);
    requestRender();
    return;
  }
  if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
    const prev = touches.get(e.pointerId)!;
    gesture.moved += Math.hypot(e.clientX - prev.x, e.clientY - prev.y);
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const c = centroid();
    const dx = c.x - gesture.lastCentroid.x;
    const dy = c.y - gesture.lastCentroid.y;
    if (touches.size === 1) {
      orbit.rotate(dx * 0.008, dy * 0.008);
    } else {
      orbit.pan(dx, dy, canvas.clientHeight);
      const d = spread();
      if (gesture.lastDist > 0 && d > 0) orbit.zoom(gesture.lastDist / d);
      gesture.lastDist = d;
    }
    gesture.lastCentroid = c;
    requestRender();
    return;
  }
  // hover (Apple Pencil hover on supported iPads, or mouse)
  if ((e.pointerType === 'pen' || e.pointerType === 'mouse') && state.tool === 'draw') {
    showCursor(e.clientX, e.clientY);
  }
});

function showCursor(x: number, y: number) {
  const plane = currentPlane();
  let p: THREE.Vector3 | null = null;
  if (state.plane === 'surface' && !state.locked) p = surfacePoint(x, y, 0);
  p ??= planePoint(x, y, plane.normal, plane.origin);
  cursor.position.copy(p);
  cursor.scale.setScalar(Math.max(radiusForDepth(p), 0.002));
  (cursor.material as THREE.MeshBasicMaterial).color.set(state.color);
  cursor.visible = true;
  requestRender();
}

function endPointer(e: PointerEvent) {
  if (live && e.pointerId === live.pointerId) {
    finishStroke(e.type === 'pointercancel' && live.data.pts.length < 2);
    touches.delete(e.pointerId);
    return;
  }
  if (erasing && e.pointerId === erasing.pointerId) {
    const ids = [...erasing.ids];
    erasing = null;
    sketch.remove(ids);
    touches.delete(e.pointerId);
    requestRender();
    return;
  }
  if (mouseNav && e.pointerType === 'mouse') {
    mouseNav = null;
    return;
  }
  if (touches.delete(e.pointerId)) {
    if (touches.size === 0) {
      const quick = performance.now() - gesture.startTime < 320 && gesture.moved < 24;
      if (quick && gesture.maxTouches === 2) sketch.undo();
      else if (quick && gesture.maxTouches === 3) sketch.redo();
    } else resetGestureBaseline();
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType !== 'touch' && !live) {
    cursor.visible = false;
    requestRender();
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (e.ctrlKey) orbit.zoom(Math.exp(e.deltaY * 0.01));
    else if (e.shiftKey) orbit.pan(-e.deltaX, -e.deltaY, canvas.clientHeight);
    else orbit.zoom(Math.exp(e.deltaY * 0.0015));
    requestRender();
  },
  { passive: false },
);
// Block Safari's page pinch-zoom & double-tap zoom.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// ---------- UI ----------
function setSeg(group: string, attr: string, value: string) {
  document.querySelectorAll<HTMLButtonElement>(`[data-group="${group}"] button`).forEach((b) => {
    b.classList.toggle('on', b.dataset[attr] === value);
  });
}

function setTool(t: Tool) {
  state.tool = t;
  setSeg('tool', 'tool', t);
  document.body.classList.toggle('erasing', t === 'erase');
  cursor.visible = false;
  requestRender();
}
function setBrush(b: Brush) {
  state.brush = b;
  setSeg('brush', 'brush', b);
}
function setPlane(p: PlaneMode) {
  state.plane = p;
  setLocked(false);
  setDepth(0);
  setSeg('plane', 'plane', p);
  updatePlaneVis(false);
  requestRender();
}
const depthInput = $<HTMLInputElement>('#depth');
function setDepth(d: number) {
  const span = Math.max(1.5, Math.abs(d) * 1.25);
  depthInput.min = String(-span);
  depthInput.max = String(span);
  state.depth = d;
  depthInput.value = String(d);
  updatePlaneVis(!!live);
  requestRender();
}
const lockBtn = $('#lockBtn');
function setLocked(on: boolean) {
  if (on) {
    const { normal, origin } = currentPlane();
    state.locked = { normal, base: origin };
    state.depth = 0;
    depthInput.value = '0';
  } else if (state.locked) {
    state.locked = null;
    state.depth = 0;
    depthInput.value = '0';
  }
  lockBtn.classList.toggle('on', on);
  updatePlaneVis(false);
  requestRender();
}
function setMirror(on: boolean) {
  state.mirror = on;
  $('#mirrorBtn').classList.toggle('on', on);
  mirrorVis.visible = on;
  requestRender();
}

document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool as Tool)));
document.querySelectorAll<HTMLButtonElement>('[data-brush]').forEach((b) => (b.onclick = () => setBrush(b.dataset.brush as Brush)));
document.querySelectorAll<HTMLButtonElement>('[data-plane]').forEach((b) => (b.onclick = () => setPlane(b.dataset.plane as PlaneMode)));
depthInput.oninput = () => setDepth(parseFloat(depthInput.value));
lockBtn.onclick = () => setLocked(!state.locked);
$('#mirrorBtn').onclick = () => setMirror(!state.mirror);
$('#anchorBtn').onclick = () => {
  state.anchor = !state.anchor;
  $('#anchorBtn').classList.toggle('on', state.anchor);
};

const swatches = $('#swatches');
function renderSwatches() {
  swatches.innerHTML = '';
  for (const c of PALETTE) {
    const b = document.createElement('button');
    b.className = 'swatch' + (c === state.color ? ' on' : '');
    b.style.background = c;
    b.title = c;
    b.onclick = () => {
      state.color = c;
      renderSwatches();
    };
    swatches.append(b);
  }
  const pick = document.createElement('label');
  pick.className = 'swatch custom' + (PALETTE.includes(state.color) ? '' : ' on');
  pick.title = 'Otro color';
  pick.style.background = PALETTE.includes(state.color) ? '' : state.color;
  const input = document.createElement('input');
  input.type = 'color';
  input.value = state.color;
  input.oninput = () => {
    state.color = input.value;
    pick.style.background = input.value;
    swatches.querySelectorAll('.swatch').forEach((s) => s.classList.remove('on'));
    pick.classList.add('on');
  };
  pick.append(input);
  swatches.append(pick);
}
renderSwatches();

const sizeInput = $<HTMLInputElement>('#size');
const sizeOut = $<HTMLOutputElement>('#sizeOut');
sizeInput.oninput = () => {
  state.sizePx = parseFloat(sizeInput.value);
  sizeOut.value = `${state.sizePx}px`;
};
sizeInput.dispatchEvent(new Event("input"));
const smoothInput = $<HTMLInputElement>('#smooth');
smoothInput.oninput = () => (state.smooth = parseFloat(smoothInput.value));

const undoBtn = $<HTMLButtonElement>('#undo');
const redoBtn = $<HTMLButtonElement>('#redo');
undoBtn.onclick = () => sketch.undo();
redoBtn.onclick = () => sketch.redo();
sketch.onChange = () => {
  undoBtn.disabled = !sketch.canUndo;
  redoBtn.disabled = !sketch.canRedo;
  document.body.classList.toggle('empty', sketch.count === 0);
  requestRender();
};

const VIEWS: Record<string, [number, number]> = {
  front: [0, Math.PI / 2],
  side: [Math.PI / 2, Math.PI / 2],
  top: [0, 0.02],
};
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => {
  b.onclick = () => {
    const v = b.dataset.view!;
    if (v === 'home') orbit.reset();
    else orbit.set(...VIEWS[v]);
    updatePlaneVis(false);
    requestRender();
  };
});

const menu = $('#menu');
function closeMenu() {
  menu.hidden = true;
}
$('#menuBtn').onclick = (e) => {
  e.stopPropagation();
  menu.hidden = !menu.hidden;
};
document.addEventListener('pointerdown', (e) => {
  if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== $('#menuBtn')) closeMenu();
});
menu.querySelectorAll<HTMLButtonElement>('[data-export]').forEach((b) => {
  b.onclick = async () => {
    closeMenu();
    const kind = b.dataset.export;
    try {
      const { exportGLB, exportJSON, exportOBJ, exportUSDZ } = await import('./exporters');
      if (kind === 'glb') await exportGLB(sketch.group);
      else if (kind === 'obj') exportOBJ(sketch.group);
      else if (kind === 'usdz') await exportUSDZ(sketch.group);
      else if (kind === 'json') exportJSON(sketch.toJSON());
    } catch (err) {
      console.error(err);
      alert('No se pudo exportar: ' + (err as Error).message);
    }
  };
});
const openFile = $<HTMLInputElement>('#openFile');
$('#openBtn').onclick = () => openFile.click();
openFile.onchange = async () => {
  const f = openFile.files?.[0];
  if (!f) return;
  try {
    sketch.load(JSON.parse(await f.text()));
  } catch {
    alert('Ese archivo no es un boceto de Trazo.');
  }
  openFile.value = '';
  closeMenu();
};
$<HTMLInputElement>('#fingerDraw').onchange = (e) => {
  state.fingerDraw = (e.target as HTMLInputElement).checked;
  document.body.classList.toggle('finger-draw', state.fingerDraw);
};
$<HTMLInputElement>('#showGrid').onchange = (e) => {
  floor.visible = (e.target as HTMLInputElement).checked;
  requestRender();
};
$('#clearBtn').onclick = () => {
  closeMenu();
  if (sketch.count && confirm('¿Borrar todo el boceto? (se puede deshacer)')) sketch.clear();
};

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) sketch.redo();
    else sketch.undo();
    return;
  }
  if (mod) return;
  const k = e.key.toLowerCase();
  if (k === 'b') setTool('draw');
  else if (k === 'e') setTool('erase');
  else if (k === 'm') setMirror(!state.mirror);
  else if (k === 'l') setLocked(!state.locked);
  else if ('12345'.includes(k) && k.length === 1) setPlane((['view', 'xy', 'yz', 'xz', 'surface'] as PlaneMode[])[+k - 1]);
  else if (k === '[') sizeInput.value = String(Math.max(1, state.sizePx - 1)), sizeInput.dispatchEvent(new Event('input'));
  else if (k === ']') sizeInput.value = String(Math.min(40, state.sizePx + 1)), sizeInput.dispatchEvent(new Event('input'));
});

// ---------- render loop ----------
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  requestRender();
}
window.addEventListener('resize', resize);
resize();

function frame() {
  if (live?.dirty) {
    live.dirty = false;
    applyMeshData(live.mesh.geometry, meshDataFor(live.data));
    if (live.mirror) applyMeshData(live.mirror.mesh.geometry, meshDataFor(live.mirror.data));
  }
  if (needsRender) {
    needsRender = false;
    if (!live) updatePlaneVis(false);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}

sketch.restore();
sketch.onChange();
updatePlaneVis(false);
requestAnimationFrame(frame);

// Expose for debugging / automated tests.
(window as unknown as { trazo: unknown }).trazo = { sketch, state, orbit, camera };

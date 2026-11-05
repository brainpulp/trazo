import type * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function assertNotEmpty(group: THREE.Object3D) {
  if (!group.children.length) throw new Error('el boceto está vacío');
}

export async function exportGLB(group: THREE.Object3D) {
  assertNotEmpty(group);
  const result = await new GLTFExporter().parseAsync(group, { binary: true });
  download(new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' }), `trazo-${stamp()}.glb`);
}

export function exportOBJ(group: THREE.Object3D) {
  assertNotEmpty(group);
  const text = new OBJExporter().parse(group);
  download(new Blob([text], { type: 'text/plain' }), `trazo-${stamp()}.obj`);
}

/** On iPad/iPhone this opens AR Quick Look so the sketch can be placed in the room. */
export async function exportUSDZ(group: THREE.Object3D) {
  assertNotEmpty(group);
  const data = await new USDZExporter().parseAsync(group);
  const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type: 'model/vnd.usdz+zip' });
  const name = `trazo-${stamp()}.usdz`;
  const supportsAR = document.createElement('a').relList.supports('ar');
  if (!supportsAR) return download(blob, name);
  const a = document.createElement('a');
  a.rel = 'ar';
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.append(document.createElement('img')); // AR Quick Look requires an <img> child
  document.body.append(a);
  a.click();
  a.remove();
}

export function exportJSON(json: unknown) {
  download(new Blob([JSON.stringify(json)], { type: 'application/json' }), `boceto-${stamp()}.trazo.json`);
}

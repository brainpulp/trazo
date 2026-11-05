import * as THREE from 'three';

/** Minimal orbit camera driven explicitly by our own gesture code (pen must never orbit). */
export class Orbit {
  target = new THREE.Vector3(0, 0.6, 0);
  radius = 3;
  theta = Math.PI * 0.18; // azimuth around Y
  phi = Math.PI * 0.4; // polar angle from +Y

  constructor(private camera: THREE.PerspectiveCamera) {
    this.update();
  }

  rotate(dTheta: number, dPhi: number) {
    this.theta -= dTheta;
    this.phi = THREE.MathUtils.clamp(this.phi - dPhi, 0.02, Math.PI - 0.02);
    this.update();
  }

  /** Pan by screen-pixel deltas so the content follows the fingers. */
  pan(dx: number, dy: number, viewportHeight: number) {
    const wpp = this.worldPerPixel(this.radius, viewportHeight);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this.target.addScaledVector(right, -dx * wpp).addScaledVector(up, dy * wpp);
    this.update();
  }

  zoom(factor: number) {
    this.radius = THREE.MathUtils.clamp(this.radius * factor, 0.05, 60);
    this.update();
  }

  set(theta: number, phi: number) {
    this.theta = theta;
    this.phi = phi;
    this.update();
  }

  reset() {
    this.target.set(0, 0.6, 0);
    this.radius = 3;
    this.set(Math.PI * 0.18, Math.PI * 0.4);
  }

  worldPerPixel(depth: number, viewportHeight: number) {
    return (2 * depth * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / viewportHeight;
  }

  update() {
    const s = new THREE.Spherical(this.radius, this.phi, this.theta);
    this.camera.position.setFromSpherical(s).add(this.target);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}

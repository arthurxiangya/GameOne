import * as THREE from 'three';

/** Owns the WebGL renderer, scene and camera, and keeps them sized to the window. */
export class SceneContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 340);
  readonly fog = new THREE.Fog(0xc3e1f4, 160, 320);
  width = 1;
  height = 1;
  private readonly projected = new THREE.Vector3();

  constructor(private readonly host: HTMLElement, lowPower: boolean) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.fog = this.fog;
    host.appendChild(this.renderer.domElement);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  setDrawDistance(near: number, far: number): void {
    this.fog.near = near;
    this.fog.far = far;
    this.camera.far = far + 30;
    this.camera.updateProjectionMatrix();
  }

  resize(): void {
    this.width = this.host.clientWidth || window.innerWidth;
    this.height = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  /** Projects a world point to CSS pixels, or null when it is behind the camera. */
  toScreen(x: number, y: number, z: number): [number, number] | null {
    const v = this.projected.set(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    return [(v.x * 0.5 + 0.5) * this.width, (-v.y * 0.5 + 0.5) * this.height];
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** What the last frame drew; a blank screen shows up here as zero triangles. */
  get renderStats(): { calls: number; triangles: number } {
    const info = this.renderer.info.render;
    return { calls: info.calls, triangles: info.triangles };
  }
}

import * as THREE from 'three';
import { clamp, smoothstep, type Vec3 } from '@lanternwood/shared';

const SKY_KEYS: readonly (readonly [number, string, string])[] = [
  [0.0, '#070b18', '#141b36'],
  [0.2, '#0c1229', '#232650'],
  [0.245, '#2c3166', '#e48a6c'],
  [0.29, '#5d98d4', '#f5c89c'],
  [0.36, '#58a2e4', '#c3e1f4'],
  [0.64, '#58a2e4', '#c3e1f4'],
  [0.705, '#5a84c6', '#f3bd8b'],
  [0.755, '#3a3972', '#ec7d58'],
  [0.8, '#131938', '#2d2752'],
  [1.0, '#070b18', '#141b36'],
];

/** three.js r155+ uses physical light units; legacy-looking scenes need intensities scaled by PI. */
const PI = Math.PI;

/**
 * Day–night cycle: gradient sky dome, stars, drifting voxel clouds, sun and moon lights
 * (the sun casts shadows around the camera focus), plus the night-time point lights.
 */
export class SkySystem {
  readonly sun = new THREE.DirectionalLight(0xfff2dc, 0.85 * PI);
  readonly moon = new THREE.DirectionalLight(0xa9b8ff, 0);
  readonly hemi = new THREE.HemisphereLight(0xdcecff, 0x5a4a3c, 0.55 * PI);
  readonly heroLight = new THREE.PointLight(0xffb04a, 0, 9, 2);
  readonly townLight = new THREE.PointLight(0xffb04a, 0, 18, 2);
  /** 0 at noon, 1 at midnight. */
  night = 0;
  /** 1 normally, eased to 0 while the Great Lantern is dark. */
  townLit = 1;

  private readonly keys = SKY_KEYS.map(([t, top, hor]) => ({ t, top: new THREE.Color(top), hor: new THREE.Color(hor) }));
  private readonly uniforms = { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uLow: { value: new THREE.Color() } };
  private readonly dome: THREE.Mesh;
  private readonly stars: THREE.Points;
  private readonly starMaterial: THREE.PointsMaterial;
  private readonly clouds: { group: THREE.Group; speed: number; material: THREE.MeshLambertMaterial }[] = [];
  private readonly sunTarget = new THREE.Object3D();
  private readonly sunDir = new THREE.Vector3();
  private readonly sunLow = new THREE.Color(0xff9a5c);
  private readonly sunHigh = new THREE.Color(0xfff4e2);
  private readonly hemiDay = new THREE.Color(0xdcecff);
  private readonly hemiNight = new THREE.Color(0x6577b0);

  constructor(private readonly scene: THREE.Scene, private readonly fog: THREE.Fog, lowPower: boolean) {
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: [
          'uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uLow; varying vec3 vP;',
          'void main(){',
          '  float h = normalize(vP).y;',
          '  vec3 c = h > 0.0 ? mix(uHor, uTop, pow(clamp(h / 0.55, 0.0, 1.0), 0.75)) : mix(uHor, uLow, clamp(-h / 0.25, 0.0, 1.0));',
          '  gl_FragColor = vec4(c, 1.0);',
          '  #include <colorspace_fragment>',
          '}',
        ].join('\n'),
      }),
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    const starPositions = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) {
      const th = Math.random() * Math.PI * 2;
      const y = 0.05 + Math.random() * 0.95;
      const s = Math.sqrt(1 - y * y);
      starPositions.set([Math.cos(th) * s, y, Math.sin(th) * s], i * 3);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    this.starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.stars = new THREE.Points(starGeometry, this.starMaterial);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
    scene.add(this.stars);

    this.buildClouds();

    this.sun.castShadow = true;
    const mapSize = lowPower ? 1024 : 2048;
    this.sun.shadow.mapSize.set(mapSize, mapSize);
    Object.assign(this.sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 260 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    this.sun.target = this.sunTarget;
    this.moon.target = this.sunTarget;
    this.townLight.position.set(0, 16.6, 0);
    scene.add(this.hemi, this.sun, this.moon, this.sunTarget, this.heroLight, this.townLight);
  }

  /** Turns off sun shadows, the most expensive part of a frame on slow GPUs. */
  disableShadows(): void {
    this.sun.castShadow = false;
  }

  /** `timeOfDay` in [0, 1); `focus` is where shadows should be sharp (the player). */
  update(timeOfDay: number, focus: Readonly<Vec3>, camera: THREE.PerspectiveCamera, dt: number): void {
    let i = 0;
    while (i < this.keys.length - 2 && timeOfDay >= this.keys[i + 1]!.t) i++;
    const a = this.keys[i]!;
    const b = this.keys[i + 1]!;
    const f = clamp((timeOfDay - a.t) / (b.t - a.t), 0, 1);
    this.uniforms.uTop.value.copy(a.top).lerp(b.top, f);
    this.uniforms.uHor.value.copy(a.hor).lerp(b.hor, f);
    this.uniforms.uLow.value.copy(this.uniforms.uHor.value).multiplyScalar(0.55);
    this.fog.color.copy(this.uniforms.uHor.value);

    const angle = (timeOfDay - 0.25) * Math.PI * 2;
    const elevation = Math.sin(angle);
    this.sunDir.set(Math.cos(angle), elevation, 0.42).normalize();
    this.sunTarget.position.set(focus.x, focus.y, focus.z);
    this.sun.position.copy(this.sunTarget.position).addScaledVector(this.sunDir, 120);
    this.moon.position.copy(this.sunTarget.position).addScaledVector(this.sunDir, -120);

    const day = smoothstep(-0.14, 0.2, elevation);
    this.night = 1 - day;
    this.sun.intensity = 0.85 * PI * smoothstep(-0.03, 0.22, elevation);
    this.sun.color.copy(this.sunLow).lerp(this.sunHigh, smoothstep(0.02, 0.5, elevation));
    this.moon.intensity = 0.42 * PI * smoothstep(-0.03, 0.22, -elevation);
    this.hemi.intensity = (0.28 + 0.3 * day) * PI;
    this.hemi.color.copy(this.hemiNight).lerp(this.hemiDay, day);
    this.townLight.intensity = 70 * this.night * (0.1 + 0.9 * this.townLit);
    this.starMaterial.opacity = 0.9 * this.night;

    this.dome.position.copy(camera.position);
    this.dome.scale.setScalar(camera.far * 0.9);
    this.stars.position.copy(camera.position);
    this.stars.scale.setScalar(camera.far * 0.85);
    this.stars.rotation.y += dt * 0.003;

    for (const c of this.clouds) {
      c.group.position.x += c.speed * dt;
      if (c.group.position.x > 140) c.group.position.x = -140;
      const toCamera = c.group.position.distanceTo(camera.position);
      c.material.opacity = 0.9 * smoothstep(10, 30, toCamera) * (1 - smoothstep(110, 140, Math.abs(c.group.position.x)));
    }
  }

  private buildClouds(): void {
    const box = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 14; i++) {
      const group = new THREE.Group();
      const material = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
      const parts = 3 + Math.floor(Math.random() * 4);
      for (let j = 0; j < parts; j++) {
        const m = new THREE.Mesh(box, material);
        m.scale.set(5 + Math.round(Math.random() * 8), Math.random() < 0.3 ? 3 : 2, 4 + Math.round(Math.random() * 6));
        m.position.set(Math.round((Math.random() - 0.5) * 10), m.scale.y / 2, Math.round((Math.random() - 0.5) * 7));
        group.add(m);
      }
      group.position.set(-130 + Math.random() * 260, 50 + Math.round(Math.random() * 8), (Math.random() - 0.5) * 220);
      this.scene.add(group);
      this.clouds.push({ group, speed: 1 + Math.random() * 1.5, material });
    }
  }
}

// Solrig eftermiddag: gradient-himmel, sol, skyer, hemisfære- og sollys med skygger der følger spilleren.
import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(-0.62, 0.55, 0.56).normalize(); // fra sydvest
export const HORIZON = new THREE.Color('#f2dcc0');
const ZENITH = new THREE.Color('#3f7fd0');

export class Sky {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private clouds: THREE.Group;
  private dome: THREE.Mesh;

  constructor(scene: THREE.Scene, shadowSize = 2048) {
    this.group.name = 'sky';
    scene.fog = new THREE.Fog(HORIZON.clone(), 220, 1100);
    scene.background = HORIZON.clone();

    const domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      uniforms: {
        uZenith: { value: ZENITH.clone() },
        uHorizon: { value: HORIZON.clone() },
        uSun: { value: SUN_DIR.clone() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSun;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uZenith, pow(h, 0.45));
          float s = max(dot(normalize(vDir), uSun), 0.0);
          col += vec3(1.0, 0.85, 0.6) * pow(s, 18.0) * 0.45;
          col += vec3(1.0, 0.95, 0.85) * smoothstep(0.9994, 0.9998, s) * 2.0;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1300, 32, 16), domeMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1;
    this.group.add(this.dome);

    this.hemi = new THREE.HemisphereLight(0xcfe2ff, 0xb39b7c, 1.25);
    this.group.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    const c = this.sun.shadow.camera;
    c.left = -75; c.right = 75; c.top = 75; c.bottom = -75; c.near = 5; c.far = 700;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.5;
    this.group.add(this.sun);
    this.group.add(this.sun.target);

    this.clouds = new THREE.Group();
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, emissive: 0xb8c4d6, fog: false });
    const geo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 18; i++) {
      const cl = new THREE.Group();
      const n = 3 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(geo, cloudMat);
        m.position.set((k - n / 2) * 18 + Math.random() * 8, Math.random() * 6, Math.random() * 14);
        const s = 14 + Math.random() * 12;
        m.scale.set(s, s * 0.45, s * 0.8);
        cl.add(m);
      }
      const a = Math.random() * Math.PI * 2, r = 250 + Math.random() * 600;
      cl.position.set(Math.cos(a) * r, 230 + Math.random() * 90, Math.sin(a) * r);
      this.clouds.add(cl);
    }
    this.group.add(this.clouds);
    scene.add(this.group);
  }

  setShadowQuality(size: number) {
    if (this.sun.shadow.mapSize.x === size) return;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
  }

  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera) {
    // Snap skyggekameraet til texel-gitteret for at undgå flimmer
    const texel = 150 / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + SUN_DIR.x * 300, SUN_DIR.y * 300, fz + SUN_DIR.z * 300);
    this.dome.position.copy(camera.position);
    for (const c of this.clouds.children) {
      c.position.x += dt * 2.2;
      if (c.position.x > 900) c.position.x = -900;
    }
  }
}

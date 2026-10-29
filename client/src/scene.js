// Renderer, camera, sky, lights and water.
import * as THREE from 'three';
import { settings, onSettings } from './settings.js';
import { WORLD } from '/shared/world-data.js';

const PRESETS = {
  sunset: { top: '#2a0f45', mid: '#c2367a', horizon: '#ff9a5a', fog: '#c96a7c', sun: '#ffd0a0', sunIntensity: 2.2, hemiSky: '#ffb9d6', hemiGround: '#3a1f4a', hemi: 1.1, exposure: 1.0, sunDir: [-0.4, 0.28, -1] },
  night: { top: '#05030f', mid: '#1a0b3a', horizon: '#4a1a5c', fog: '#1b0f30', sun: '#8fa8ff', sunIntensity: 0.6, hemiSky: '#5a4aa0', hemiGround: '#120822', hemi: 0.75, exposure: 1.15, sunDir: [0.3, 0.6, -1] },
};

export function createScene(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: settings.graphics === 'high', powerPreference: 'high-performance' });
  renderer.setPixelRatio(settings.graphics === 'high' ? Math.min(window.devicePixelRatio, 1.75) : 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = settings.graphics === 'high';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 900);

  // Sky dome with a gradient shader.
  const skyUniforms = {
    top: { value: new THREE.Color() },
    mid: { value: new THREE.Color() },
    horizon: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3() },
    sunColor: { value: new THREE.Color() },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(800, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: skyUniforms,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 c = mix(horizon, mid, smoothstep(0.0, 0.25, h));
          c = mix(c, top, smoothstep(0.25, 0.8, h));
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          c += sunColor * (pow(s, 600.0) * 1.5 + pow(s, 12.0) * 0.25);
          // Retro sun stripes near the horizon.
          if (s > 0.995 && fract(vDir.y * 90.0) < 0.25 && vDir.y < sunDir.y) c = mix(c, horizon, 0.7);
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  sky.renderOrder = -1;
  scene.add(sky);

  const hemi = new THREE.HemisphereLight();
  scene.add(hemi);
  const sun = new THREE.DirectionalLight();
  sun.castShadow = settings.graphics === 'high';
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 300;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);
  scene.fog = new THREE.Fog('#c96a7c', 120, 520);

  // Ocean: a low-res grid animated on the CPU.
  const waterGeo = new THREE.PlaneGeometry(WORLD.maxX - WORLD.minX + 600, 400, 60, 20);
  waterGeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(waterGeo, new THREE.MeshPhongMaterial({ color: '#1fb5c9', emissive: '#0b2a4a', specular: '#ffd6f0', shininess: 90, transparent: true, opacity: 0.92, flatShading: true }));
  water.position.set((WORLD.minX + WORLD.maxX) / 2, -1.4, WORLD.waterZ - 190);
  scene.add(water);
  const basePos = waterGeo.attributes.position.array.slice();

  let preset = null;
  function applyLighting(name) {
    const p = PRESETS[name] || PRESETS.sunset;
    preset = p;
    skyUniforms.top.value.set(p.top);
    skyUniforms.mid.value.set(p.mid);
    skyUniforms.horizon.value.set(p.horizon);
    skyUniforms.sunDir.value.set(...p.sunDir).normalize();
    skyUniforms.sunColor.value.set(p.sun);
    hemi.color.set(p.hemiSky);
    hemi.groundColor.set(p.hemiGround);
    hemi.intensity = p.hemi;
    sun.color.set(p.sun);
    sun.intensity = p.sunIntensity;
    scene.fog.color.set(p.fog);
    renderer.toneMappingExposure = p.exposure;
    scene.userData.night = name === 'night';
  }
  applyLighting(settings.lighting);
  onSettings((s, patch) => {
    if ('lighting' in patch) applyLighting(s.lighting);
  });

  function resize() {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();

  let waterTime = 0;
  function update(dt, focus) {
    // Keep the sun's shadow box centred on the player.
    const d = new THREE.Vector3(...preset.sunDir).normalize();
    sun.position.set(focus.x - d.x * 120, 120 * Math.max(0.35, d.y) + 40, focus.z - d.z * 120);
    sun.target.position.copy(focus);
    sky.position.copy(camera.position);
    waterTime += dt;
    const pos = waterGeo.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i + 1] = basePos[i + 1] + Math.sin(basePos[i] * 0.05 + waterTime * 1.3) * 0.25 + Math.cos(basePos[i + 2] * 0.08 + waterTime) * 0.2;
    }
    waterGeo.attributes.position.needsUpdate = true;
  }

  return { renderer, scene, camera, resize, update, applyLighting };
}

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

// 场景初始化：创建透明背景的 3D 场景，支持底层极光背景显示
export function setupScene() {
  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(45, 2, 0.1, 2000);
  camera.position.set(2.8, 1.6, 3.2);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
    alpha: true, // 启用 alpha 通道以支持透明背景
  });
  renderer.setClearColor(0x000000, 0); // 清除颜色设为透明
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  // 环境光照：使用 RoomEnvironment 提供基础反射，强度 0.04 保持低调
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 0.5));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(5, 6, 8);
  scene.add(dirLight);

  const grid = new THREE.GridHelper(10, 10, 0x334155, 0x1f2937);
  grid.visible = false; // 默认隐藏，避免与极光背景冲突
  scene.add(grid);

  const worldAxes = new THREE.AxesHelper(1.2);
  worldAxes.material.depthTest = false;
  worldAxes.renderOrder = 10;
  scene.add(worldAxes);

  return { scene, camera, renderer, controls, grid };
}

// 响应式调整：使用 ResizeObserver 自动适配窗口大小变化
export function setupResize(camera, renderer, controls) {
  const viewport = document.getElementById("viewport");
  const resize = () => {
    const rect = viewport.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    controls.update();
  };
  new ResizeObserver(resize).observe(viewport);
  resize();
}

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export function setupScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0b0b);

    const camera = new THREE.PerspectiveCamera(45, 2, 0.1, 2000);
    camera.position.set(2.8, 1.6, 3.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 0.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(5, 6, 8);
    scene.add(dirLight);

    const grid = new THREE.GridHelper(10, 10, 0x334155, 0x1f2937);
    grid.visible = false;
    scene.add(grid);

    const worldAxes = new THREE.AxesHelper(1.2);
    worldAxes.material.depthTest = false;
    worldAxes.renderOrder = 10;
    scene.add(worldAxes);

    return { scene, camera, renderer, controls, grid };
}

export function setupResize(camera, renderer, controls) {
    const viewport = document.getElementById('viewport');
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
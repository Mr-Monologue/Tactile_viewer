import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { setupScene, setupResize } from './core/scene-setup.js';
import { TactileLayer } from './core/tactile-layer.js';
import { frameToObject, mapAxes } from './core/utils.js';

// ================== BUG 修复：导入并使用正确的函数名 ==================
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
// ====================================================================

// --- Global State ---
let current = null, aligner = null, mixer = null, tactile = null;

// --- Initialize Scene ---
const { scene, camera, renderer, controls, grid } = setupScene();
document.getElementById('viewport').appendChild(renderer.domElement);
setupResize(camera, renderer, controls);

// --- Loaders ---
const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
loader.setDRACOLoader(dracoLoader);
loader.setMeshoptDecoder(MeshoptDecoder);

// --- Core Logic ---
async function loadURL(url, name = '模型') {
    document.getElementById('info').textContent = `加载中：${name} ...`;
    try {
        if (tactile) tactile.dispose();
        if (aligner) scene.remove(aligner);

        const gltf = await loader.loadAsync(url);
        current = gltf.scene;

        aligner = new THREE.Group();
        scene.add(aligner);
        aligner.add(current);
        mapAxes(aligner, { x: '-x', y: '-y', z: '+z' });
        aligner.updateWorldMatrix(true, true);

        mixer = null;
        if (gltf.animations?.length) {
            mixer = new THREE.AnimationMixer(current);
            mixer.clipAction(gltf.animations[0]).play();
        }
        
        const touchArea = current.getObjectByName('touch_area');
         if (touchArea) {
            touchArea.traverse(o => {
                if (o.isMesh) { 
                    o.material = o.material.clone();
                    o.material.transparent = true; 
                    o.material.opacity = 0.0;
                }
            });
        }
        const target = touchArea || current;

        frameToObject(camera, controls, aligner);

        const modelSize = new THREE.Box3().setFromObject(aligner).getSize(new THREE.Vector3()).length();
        tactile = new TactileLayer(scene, target, { spacing: modelSize / 100, maxPoints: 8000 });
        await tactile.generateHexGrid(camera);

        const tris = renderer.info.render.triangles;
        document.getElementById('info').innerHTML = `✅ 已加载：<span class="num">${name}</span>`;
        document.getElementById('stats').innerHTML = `三角面 <span class="num">${tris.toLocaleString()}</span>`;

        resetView();
    } catch (e) {
        console.error(e);
        document.getElementById('info').textContent = `❌ 加载失败：${e.message || e}`;
    }
}

function resetView() {
    if (aligner) frameToObject(camera, controls, aligner);
}

// --- UI Event Listeners ---
const fileInput = document.getElementById('file');
fileInput.addEventListener('change', () => {
    const f = fileInput.files[0]; if (!f) return; loadURL(URL.createObjectURL(f), f.name);
});
document.getElementById('btnResample').addEventListener('click', async () => {
    if (!current || !tactile) return;
    await tactile.generateHexGrid(camera);
});
document.getElementById('btnReset').addEventListener('click', resetView);
document.getElementById('chkAuto').addEventListener('change', e => { controls.autoRotate = e.target.checked; });
document.getElementById('chkBg').addEventListener('change', e => {
    scene.background.set(e.target.checked ? 0x0b0b0b : 0xf8fafc);
    grid.visible = !e.target.checked;
});

// --- Animation Loop ---
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    controls.update();
    mixer?.update(dt);
    if (tactile?.running) {
        tactile.matDisks.uniforms.camRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
        tactile.matDisks.uniforms.camUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
        tactile.updateVisuals(dt);
    }
    renderer.render(scene, camera);
}

animate();
loadURL('/finger_1.glb', '默认模型');
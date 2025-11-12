import "./style.css";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { setupScene, setupResize } from "./core/scene-setup.js";
import { TactileLayer } from "./core/tactile-layer.js";
import { frameToObject, mapAxes } from "./core/utils.js";
import { DataProcessor } from "./core/data-processor.js";
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from "three-mesh-bvh";

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

let current = null,
  aligner = null,
  mixer = null,
  tactile = null;
const dataProcessor = new DataProcessor();

const { scene, camera, renderer, controls, grid } = setupScene();
document.getElementById("viewport").appendChild(renderer.domElement);
setupResize(camera, renderer, controls);

const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader().setDecoderPath(
  "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/"
);
loader.setDRACOLoader(dracoLoader);
loader.setMeshoptDecoder(MeshoptDecoder);

async function loadURL(url, name = "模型") {
  document.getElementById("info").textContent = `加载中：${name} ...`;
  try {
    if (tactile) tactile.dispose();
    if (aligner) scene.remove(aligner);

    const gltf = await loader.loadAsync(url);
    current = gltf.scene;

    aligner = new THREE.Group();
    scene.add(aligner);
    aligner.add(current);
    mapAxes(aligner, { x: "-x", y: "-y", z: "+z" });
    aligner.updateWorldMatrix(true, true);

    mixer = null;
    if (gltf.animations?.length) {
      mixer = new THREE.AnimationMixer(current);
      mixer.clipAction(gltf.animations[0]).play();
    }

    const touchArea = current.getObjectByName("touch_area");
    if (touchArea) {
      touchArea.traverse((o) => {
        if (o.isMesh) {
          o.material = o.material.clone();
          o.material.transparent = true;
          o.material.opacity = 0.0;
        }
      });
    }
    const target = touchArea || current;

    frameToObject(camera, controls, aligner);

    const modelSize = new THREE.Box3()
      .setFromObject(aligner)
      .getSize(new THREE.Vector3())
      .length();
    tactile = new TactileLayer(scene, target, {
      spacing: modelSize / 100,
      maxPoints: 8000,
    });
    await tactile.generateHexGrid(camera);

    const tris = renderer.info.render.triangles;
    document.getElementById(
      "info"
    ).innerHTML = `✅ 已加载：<span class="num">${name}</span>`;
    document.getElementById(
      "stats"
    ).innerHTML = `三角面 <span class="num">${tris.toLocaleString()}</span>`;

    resetView();
  } catch (e) {
    console.error(e);
    document.getElementById("info").textContent = `❌ 加载失败：${
      e.message || e
    }`;
  }
}

function resetView() {
  if (aligner) frameToObject(camera, controls, aligner);
}

const fileInput = document.getElementById("file");
fileInput.addEventListener("change", () => {
  const f = fileInput.files[0];
  if (!f) return;
  loadURL(URL.createObjectURL(f), f.name);
});
document.getElementById("btnResample").addEventListener("click", async () => {
  if (!current || !tactile) return;
  await tactile.generateHexGrid(camera);
});
document.getElementById("btnReset").addEventListener("click", resetView);
document.getElementById("chkAuto").addEventListener("change", (e) => {
  controls.autoRotate = e.target.checked;
});
document.getElementById("chkBg").addEventListener("change", (e) => {
  scene.background.set(e.target.checked ? 0x0b0b0b : 0xf8fafc);
  grid.visible = !e.target.checked;
});

// ================== 升级版 Web Serial API 逻辑 ==================
const btnConnect = document.getElementById("btnConnect");

let port;

let isConnected = false;

let keepReading = false;

let reader;

async function disconnectSerial() {
  if (reader) {
    keepReading = false;

    await reader.cancel(); // 强制 reader.read() 结束

    // reader.releaseLock(); // reader.cancel() 会自动释放锁
  }

  if (port) {
    await port.close();

    port = null;
  }

  isConnected = false;

  btnConnect.textContent = "连接设备";

  btnConnect.style.color = "";

  console.log("串口已断开");

  if (tactile) {
    tactile.animationState = "IDLE"; // 恢复随机动画
  }
}

async function connectAndReadSerial() {
  if (isConnected) {
    await disconnectSerial();

    return;
  }

  try {
    if (!("serial" in navigator)) {
      alert("抱歉，您的浏览器不支持 Web Serial API。");
      return;
    }

    port = await navigator.serial.requestPort();

    await port.open({ baudRate: 115200 });

    isConnected = true;

    keepReading = true;

    if (tactile) tactile.animationState = null;

    btnConnect.textContent = "校准中...";

    btnConnect.style.color = "#facc15";

    dataProcessor.startCalibration();

    let buffer = "";

    reader = port.readable.getReader();

    const textDecoder = new TextDecoder();

    while (keepReading) {
      const { value, done } = await reader.read();

      if (done) break;

      buffer += textDecoder.decode(value, { stream: true });

      const lines = buffer.split("\n");

      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim() || line.split(",").length !== 12) continue;

        try {
          const packet = line.split(",").map(parseFloat);

          if (dataProcessor.isCalibrating) {
            if (dataProcessor.addCalibrationPacket(packet)) {
              btnConnect.textContent = "断开连接";

              btnConnect.style.color = "#f87171"; // 红色，表示可断开
            }
          } else {
            const result = dataProcessor.process(packet);

            if (tactile && result) {
              tactile.updateFromSensorData(
                result.x,
                result.y,
                result.intensity
              );
            }
          }
        } catch (e) {
          console.error("解析数据失败:", e);
        }
      }
    }
  } catch (error) {
    console.error("串口操作失败:", error);

    await disconnectSerial(); // 失败时也确保清理
  } finally {
    if (reader) reader.releaseLock();
  }
}

btnConnect.addEventListener("click", connectAndReadSerial);

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  controls.update();
  mixer?.update(dt);
  if (tactile?.running) {
    tactile.matDisks.uniforms.camRight.value.setFromMatrixColumn(
      camera.matrixWorld,
      0
    );
    tactile.matDisks.uniforms.camUp.value.setFromMatrixColumn(
      camera.matrixWorld,
      1
    );
    tactile.updateVisuals(dt);
  }
  renderer.render(scene, camera);
}

animate();
loadURL("/finger_1.glb", "默认模型");

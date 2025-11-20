import "./style.css";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { setupScene, setupResize } from "./core/scene-setup.js"; // 引入通用的setupResize，但我们在下面会覆盖它
import { TactileLayer } from "./core/tactile-layer.js";
import { frameToObject, mapAxes } from "./core/utils.js";
import { DataProcessor } from "./core/data-processor.js";
import { ChartManager } from "./core/chart-manager.js";
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from "three-mesh-bvh";

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// --- Global State ---
let current = null,
  aligner = null,
  mixer = null,
  tactile = null;
const dataProcessor = new DataProcessor();
// ================== 修改：初始化 4 个图表 ==================
const chartManager = new ChartManager(
  { x: "x-chart", y: "y-chart", z: "z-chart", f: "force-chart" },
  { rawMax: 0.6, forceMax: 12.0 }
);
// ========================================================

// --- UI Elements ---
const btnConnect = document.getElementById("btnConnect");
const statusOverlay = document.getElementById("status-overlay");
const toolbarIcons = document.querySelectorAll(".toolbar-icon");
const dockPanels = document.querySelectorAll(".dock-panel");
const deviceControlIcon = document.querySelector(
  '[data-panel="device-panel"] i'
);
const deviceControlPanel = document.getElementById("device-panel");
const deviceControlToolbarIcon = document.querySelector(
  '[data-panel="device-panel"]'
);
const deviceStatusIndicator = document.getElementById("device-status");
const deviceStatusText = deviceStatusIndicator.querySelector(".status-text");
const toast = document.getElementById("toast-notification");

statusOverlay.style.opacity = 1;

// --- Initialize Scene ---
const { scene, camera, renderer, controls, grid } = setupScene();
document.getElementById("viewport").appendChild(renderer.domElement);

// ================== 核心修复：回归最纯粹的标准 Resize 逻辑 ==================
function setupStandardResize() {
  const viewport = document.getElementById("viewport");
  const dataPanel = document.getElementById("data-panel");
  const statusOverlay = document.getElementById("status-overlay");

  const resize = () => {
    const rect = viewport.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);

    renderer.setSize(width, height);
    camera.aspect = width / height;

    // 获取右侧面板的实际宽度 (现在是 1/3 屏幕宽)
    let panelWidth = 0;
    if (dataPanel) {
      panelWidth = dataPanel.offsetWidth + 20; // 加上右边距
    }

    // 摄像机偏移：依然是面板宽度的一半，确保模型居中于剩余的 2/3 区域
    const xOffset = panelWidth / 2;
    camera.setViewOffset(width, height, xOffset, 0, width, height);

    camera.updateProjectionMatrix();
    controls.update();

    // ================== 提示框居中逻辑 (保持不变，但逻辑上现在是居中于2/3区域) ==================
    // 左侧可用宽度 = 总宽度 - 面板宽度
    const leftAvailableWidth = width - panelWidth;
    // 提示框中心点 = 左侧可用宽度 / 2
    const visualCenterX = leftAvailableWidth / 2;

    if (statusOverlay) {
      statusOverlay.style.left = `${visualCenterX}px`;
      statusOverlay.style.bottom = `${height * 0.15}px`;
    }
    // ========================================================================================
  };

  new ResizeObserver(resize).observe(viewport);
  resize();
}
setupStandardResize();
// =======================================================================

// --- Loaders ---
const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader().setDecoderPath(
  "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/"
);
loader.setDRACOLoader(dracoLoader);
loader.setMeshoptDecoder(MeshoptDecoder);

// --- Core Logic ---
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

    // 此时相机宽高比已正确，frameToObject 将完美居中
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

function showToast(message) {
  if (!toast) {
    console.warn("Toast:", message);
    return;
  }
  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 4000);
}
let toastTimer;

function updateConnectionStatus(status) {
  switch (status) {
    case "virtual":
      statusOverlay.style.opacity = 1;
      deviceStatusIndicator.classList.remove("connected");
      deviceStatusText.textContent = "虚拟数据";
      btnConnect.textContent = "连接设备";
      btnConnect.style.color = "";
      deviceControlIcon.classList.remove("fa-link");
      deviceControlIcon.classList.add("fa-unlink");
      deviceControlToolbarIcon.classList.remove("connected-icon");
      if (tactile) tactile.animationState = "IDLE";
      break;
    case "calibrating":
      statusOverlay.style.opacity = 0;
      deviceStatusIndicator.classList.remove("connected");
      deviceStatusText.textContent = "校准中...";
      btnConnect.textContent = "校准中...";
      btnConnect.style.color = "#facc15";
      break;
    case "connected":
      deviceStatusIndicator.classList.add("connected");
      deviceStatusText.textContent = "已连接";
      btnConnect.textContent = "断开连接";
      btnConnect.style.color = "#f87171";
      deviceControlIcon.classList.remove("fa-unlink");
      deviceControlIcon.classList.add("fa-link");
      deviceControlToolbarIcon.classList.add("connected-icon");
      if (tactile) tactile.animationState = null;
      deviceControlPanel.classList.remove("visible");
      deviceControlToolbarIcon.classList.remove("active");
      break;
    case "disconnected":
      statusOverlay.style.opacity = 1;
      deviceStatusIndicator.classList.remove("connected");
      deviceStatusText.textContent = "未连接";
      btnConnect.textContent = "连接设备";
      btnConnect.style.color = "";
      deviceControlIcon.classList.remove("fa-link");
      deviceControlIcon.classList.add("fa-unlink");
      deviceControlToolbarIcon.classList.remove("connected-icon");
      if (tactile) tactile.animationState = "IDLE";
      deviceControlPanel.classList.add("visible");
      deviceControlToolbarIcon.classList.add("active");
      break;
  }
}

function resetView() {
  if (aligner) frameToObject(camera, controls, aligner);
}

function setupToolbar() {
  toolbarIcons.forEach((icon) => {
    icon.addEventListener("click", () => {
      const panelId = icon.dataset.panel;
      const targetPanel = document.getElementById(panelId);
      const wasActive = icon.classList.contains("active");
      toolbarIcons.forEach((i) => i.classList.remove("active"));
      dockPanels.forEach((p) => p.classList.remove("visible"));
      if (!wasActive) {
        icon.classList.add("active");
        targetPanel.classList.add("visible");
      }
    });
  });
  deviceControlPanel.classList.add("visible");
  deviceControlToolbarIcon.classList.add("active");
}

let port,
  isConnected = false,
  keepReading = false,
  reader;

async function disconnectSerial() {
  btnConnect.disabled = true;
  btnConnect.textContent = "断开中...";
  if (reader) {
    keepReading = false;
    await reader.cancel().catch(() => {});
  }
  if (port) {
    await port.close();
    port = null;
  }
  isConnected = false;
  console.log("串口已断开");
  updateConnectionStatus("disconnected");
  btnConnect.disabled = false;
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
    btnConnect.disabled = true;
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    btnConnect.disabled = false;
    isConnected = true;
    keepReading = true;
    updateConnectionStatus("calibrating");

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
              updateConnectionStatus("connected");
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
    btnConnect.disabled = false;
    console.error("串口操作失败:", error);
    if (error.name === "NotFoundError") showToast("您没有选择任何串口设备。");
    else if (error.name === "InvalidStateError")
      showToast("连接失败：端口已被占用或设备已断开。");
    else showToast("发生未知错误，请重试。");
    await disconnectSerial();
  } finally {
    if (reader) reader.releaseLock();
  }
}

// --- UI Event Listeners ---
btnConnect.addEventListener("click", connectAndReadSerial);
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
const chkBg = document.getElementById("chkBg");
chkBg.addEventListener("change", (e) => {
  // 如果勾选 -> 纯黑背景 (0x0b0b0b)
  // 如果不勾选 -> 透明背景 (null)，显示极光
  scene.background = e.target.checked ? new THREE.Color(0x0b0b0b) : null;
  // 网格在纯色背景下显示，在极光背景下隐藏(以免太乱)
  grid.visible = e.target.checked;
});

// ================== 新增：初始化背景状态 ==================
// 根据 HTML 中 checkbox 的默认状态来设置背景
// 如果 index.html 里没有 checked 属性，这里就会设为透明
scene.background = chkBg.checked ? new THREE.Color(0x0b0b0b) : null;
grid.visible = chkBg.checked;
// ========================================================

// --- Animation Loop ---
const clock = new THREE.Clock();
let timeSinceLastChartUpdate = 0;
const CHART_UPDATE_INTERVAL = 0.1;

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
    if (!isConnected) {
      tactile._updatePressAnimation(dt);
    }
    tactile.updateVisuals(dt);
  }
  timeSinceLastChartUpdate += dt;
  if (timeSinceLastChartUpdate > CHART_UPDATE_INTERVAL) {
    const { rawData, forceData } = dataProcessor.getAndClearChartData() || {};

    // ================== 修改：调用新的统一更新方法 ==================
    if (rawData || forceData) {
      chartManager.updateCharts(rawData, forceData);
    }
    // ==========================================================

    timeSinceLastChartUpdate = 0;
  }
  renderer.render(scene, camera);
}

// --- Initial Load ---
setupToolbar();
animate();
loadURL("/finger_1.glb", "默认模型");

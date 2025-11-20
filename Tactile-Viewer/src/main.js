import "./style.css";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { setupScene } from "./core/scene-setup.js";
import { TactileLayer } from "./core/tactile-layer.js";
import { frameToObject, mapAxes } from "./core/utils.js";
import { DataProcessor } from "./core/data-processor.js";
import { ChartManager } from "./core/chart-manager.js";
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from "three-mesh-bvh";

// 扩展 Three.js 原型以支持 BVH 加速：选择 three-mesh-bvh 是因为它能大幅提升复杂模型的射线检测性能
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

let current = null,
  aligner = null,
  mixer = null,
  tactile = null;
const dataProcessor = new DataProcessor();
const chartManager = new ChartManager(
  { x: "x-chart", y: "y-chart", z: "z-chart", f: "force-chart" },
  { rawMax: 0.6, forceMax: 12.0 }
);

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

const { scene, camera, renderer, controls, grid } = setupScene();
document.getElementById("viewport").appendChild(renderer.domElement);

// 视图适配逻辑：使用 setViewOffset 让 3D 场景避开右侧数据面板，视觉上居中
// 假设：数据面板占据右侧 1/3 空间，需要将相机视图向右偏移面板宽度的一半
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

    let panelWidth = 0;
    if (dataPanel) {
      panelWidth = dataPanel.offsetWidth + 20;
    }

    // 相机偏移 = 面板宽度 / 2，使得模型在剩余空间居中
    const xOffset = panelWidth / 2;
    camera.setViewOffset(width, height, xOffset, 0, width, height);

    camera.updateProjectionMatrix();
    controls.update();

    // 状态提示框居中于左侧可见区域（2/3 宽度）
    if (statusOverlay) {
      const leftAvailableWidth = width - panelWidth;
      statusOverlay.style.left = `${leftAvailableWidth / 2}px`;
      statusOverlay.style.bottom = `${height * 0.15}px`;
    }
  };

  new ResizeObserver(resize).observe(viewport);
  resize();
}
setupStandardResize();

const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader().setDecoderPath(
  "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/"
);
loader.setDRACOLoader(dracoLoader);
loader.setMeshoptDecoder(MeshoptDecoder);

// 模型加载：使用 aligner 包裹原模型以统一坐标变换，假设模型需要 -x, -y, +z 映射到标准 XYZ
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

    // touch_area 网格作为触觉采样目标，需隐藏其材质以便只显示点云
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

    // 点间距根据模型尺寸动态调整：假设平均模型尺寸，除以 100 得到合适的采样密度
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

// 状态机：管理 UI 状态与触觉层动画的同步
// 关键假设：连接状态下禁用自动动画，断开时恢复
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

// 工具栏互斥逻辑：同一时间只允许一个面板打开，点击已激活的图标会关闭面板
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

// 断开逻辑：必须先取消 reader 才能安全关闭端口，否则会阻塞
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

// 串口数据流：使用行缓冲处理不完整数据包，假设每行 12 个逗号分隔的浮点数
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
  scene.background = e.target.checked ? new THREE.Color(0x0b0b0b) : null;
  grid.visible = e.target.checked;
});

// 背景初始化：根据 HTML checkbox 默认状态设置，默认透明以显示极光背景
scene.background = chkBg.checked ? new THREE.Color(0x0b0b0b) : null;
grid.visible = chkBg.checked;

const btnHelp = document.getElementById("btnHelp");
const helpModal = document.getElementById("help-modal");
const closeHelp = document.querySelector(".close-modal");

function toggleHelpModal(show) {
  if (show) {
    helpModal.classList.add("active");
  } else {
    helpModal.classList.remove("active");
  }
}

if (btnHelp) {
  btnHelp.addEventListener("click", () => toggleHelpModal(true));
}

if (closeHelp) {
  closeHelp.addEventListener("click", () => toggleHelpModal(false));
}

if (helpModal) {
  helpModal.addEventListener("click", (e) => {
    if (e.target === helpModal) {
      toggleHelpModal(false);
    }
  });
}

const btnContactModal = document.getElementById("btnContact");
const contactModal = document.getElementById("contact-modal");

function toggleContactModal(show) {
  if (show) {
    contactModal.classList.add("active");
  } else {
    contactModal.classList.remove("active");
  }
}

if (btnContactModal) {
  btnContactModal.addEventListener("click", () => toggleContactModal(true));
}

if (contactModal) {
  // 点击检测：只有点击遮罩本身或其直接子元素才关闭，避免卡片交互触发关闭
  contactModal.addEventListener("click", (e) => {
    if (
      e.target === contactModal ||
      e.target.classList.contains("contact-modal-body")
    ) {
      toggleContactModal(false);
    }
  });
}

const clock = new THREE.Clock();
let timeSinceLastChartUpdate = 0;
const CHART_UPDATE_INTERVAL = 0.1;

// 主循环：触觉层需要每帧更新相机向量以保持 billboard 效果（始终面向相机）
// 节流策略：图表更新频率设为 10Hz，避免过度渲染影响性能
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  controls.update();
  mixer?.update(dt);
  if (tactile?.running) {
    // billboard 效果：使用相机矩阵的列向量作为 right/up 方向
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
    if (rawData || forceData) {
      chartManager.updateCharts(rawData, forceData);
    }
    timeSinceLastChartUpdate = 0;
  }
  renderer.render(scene, camera);
}

setupToolbar();
animate();
loadURL("/finger_1.glb", "默认模型");

import * as THREE from "three";

// 复制Python代码中的核心常量
const AXIS_ORDER = [0, 1, 2];
const SIGN_VEC = new THREE.Vector3(-1, -1, -1);
const CHIP_MAP = [0, 1, 2, 3]; // JS数组索引从0开始

const ADC_FULL = 80.0;
const PRESS_THR = 0.01;

// 在文件顶部定义传感器位置布局
const SENSOR_POSITIONS = [
  { x: 1, y: 1 }, // Chip 0: 左上
  { x: -1, y: 1 }, // Chip 1: 右上
  { x: 1, y: -1 }, // Chip 2: 左下
  { x: -1, y: -1 }, // Chip 3: 右下
  // 注意：请根据您的实际硬件布局调整这个顺序！
  // 如果您的CHIP_MAP映射不同，这里的顺序也要对应调整。
];

// ================== 新增：方向反转控制开关 ==================
// 如果发现X轴左右反了，请将此项改为 true
const INVERT_X = true;
// 如果发现Y轴上下反了，请将此项改为 true
const INVERT_Y = false; // 根据Python代码，Y轴很可能需要反转
// ==========================================================

export class DataProcessor {
  constructor(options = {}) {
    this.zeroBaseline = null;
    this.zeroSum = new Array(4).fill(null).map(() => new THREE.Vector3());
    this.zeroCount = 0;
    this.zeroFrames = options.zeroFrames || 10;
    this.isCalibrating = false;
    this.rawChartDataBuffer = [];
    this.forceChartDataBuffer = []; // 新增：力值图表数据缓冲区
  }

  startCalibration() {
    this.zeroBaseline = null;
    this.zeroSum.forEach((v) => v.set(0, 0, 0));
    this.zeroCount = 0;
    this.isCalibrating = true;
    console.log("开始零点校准...");
  }

  // 处理原始的12个浮点数数组
  addCalibrationPacket(packet) {
    if (!this.isCalibrating || this.zeroBaseline) return;

    const vec = this._packetToVectors(packet);
    for (let i = 0; i < 4; i++) {
      this.zeroSum[i].add(vec[i]);
    }
    this.zeroCount++;

    if (this.zeroCount >= this.zeroFrames) {
      this.zeroBaseline = this.zeroSum.map((v) =>
        v.clone().multiplyScalar(1 / this.zeroCount)
      );
      this.isCalibrating = false;
      console.log(
        "✅ 零点基线采集完成!",
        this.zeroBaseline.map((v) => v.toArray())
      );
      // 返回true表示校准完成
      return true;
    }
    // 返回false表示仍在校准中
    return false;
  }

  // 将原始12浮点数数组转换为4个Vector3
  _packetToVectors(packet) {
    const raw = [
      new THREE.Vector3().fromArray(packet, 0),
      new THREE.Vector3().fromArray(packet, 3),
      new THREE.Vector3().fromArray(packet, 6),
      new THREE.Vector3().fromArray(packet, 9),
    ];

    const mapped = CHIP_MAP.map((i) => raw[i]);

    const vectors = mapped.map((v) =>
      new THREE.Vector3(
        v.getComponent(AXIS_ORDER[0]),
        v.getComponent(AXIS_ORDER[1]),
        v.getComponent(AXIS_ORDER[2])
      ).multiply(SIGN_VEC)
    );

    return vectors;
  }

  // 处理实时数据并返回最终的按压信息
  process(packet) {
    if (!this.zeroBaseline) {
      console.warn("尚未校准，无法处理数据。");
      return null;
    }

    const currentVectors = this._packetToVectors(packet);

    // 1. 计算每个传感器的独立 Z 轴压力值 (权重)
    const weights = [];
    let totalWeight = 0;
    let maxWeight = 0;

    for (let i = 0; i < 4; i++) {
      // 计算该传感器的变化向量
      const delta = currentVectors[i].clone().sub(this.zeroBaseline[i]);

      // 取Z轴绝对值作为该传感器的压力权重
      // 这里可以加一个微小的死区或噪声过滤
      let w = Math.abs(delta.z);
      if (w < 2.0) w = 0; // 过滤掉底噪

      weights.push(w);
      totalWeight += w;
      if (w > maxWeight) maxWeight = w;
    }

    // 将原始总压力推入图表缓冲区
    const rawZTotal = totalWeight / 4; // 取平均值作为总压力指标
    const z_amp_visual = THREE.MathUtils.clamp(rawZTotal / ADC_FULL, 0, 1);
    this.rawChartDataBuffer.push(z_amp_visual);

    const CALIBRATION_FACTOR = 0.263;
    const forceValue = rawZTotal * CALIBRATION_FACTOR;
    this.forceChartDataBuffer.push(forceValue);

    // 如果总压力太小，视为无操作
    if (z_amp_visual < PRESS_THR) {
      return { x: 0, y: 0, intensity: 0 };
    }

    // ================== 核心升级：重心法计算坐标 ==================
    let weightedX = 0;
    let weightedY = 0;

    for (let i = 0; i < 4; i++) {
      const w = weights[i];
      // 简单的线性加权
      weightedX += SENSOR_POSITIONS[i].x * w;
      weightedY += SENSOR_POSITIONS[i].y * w;
    }

    // 归一化坐标
    let x_pos = weightedX / totalWeight;
    let y_pos = weightedY / totalWeight;

    // 翻转修正 (保留之前的逻辑)
    if (INVERT_X) x_pos = -x_pos;
    if (INVERT_Y) y_pos = -y_pos; // 注意：如果传感器位置定义得当，可能不需要这个翻转了

    // 限制范围
    x_pos = THREE.MathUtils.clamp(x_pos, -1, 1);
    y_pos = THREE.MathUtils.clamp(y_pos, -1, 1);
    // ==========================================================

    // 强度计算保持不变，或者使用 maxWeight 来表示峰值强度
    const intensity_raw = (z_amp_visual - PRESS_THR) / (1 - PRESS_THR);
    const z_gain = 2.5;
    const intensity = Math.min(intensity_raw * z_gain, 1.0);

    return {
      x: x_pos,
      y: y_pos,
      intensity: intensity,
    };
  }

  // ================== 新增：获取并清空缓冲区的方法 ==================
  getAndClearChartData() {
    if (this.rawChartDataBuffer.length === 0) return {};
    const rawData = [...this.rawChartDataBuffer];
    const forceData = [...this.forceChartDataBuffer];
    this.rawChartDataBuffer = [];
    this.forceChartDataBuffer = [];
    return { rawData, forceData };
  }
}

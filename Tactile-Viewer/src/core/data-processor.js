import * as THREE from "three";

// 复制Python代码中的核心常量
const AXIS_ORDER = [0, 1, 2];
const SIGN_VEC = new THREE.Vector3(-1, -1, -1);
const CHIP_MAP = [0, 1, 2, 3]; // JS数组索引从0开始

const ADC_FULL = 80.0;
const PRESS_THR = 0.01;

// 在文件顶部定义传感器位置布局
const SENSOR_POSITIONS = [
  { x: 1, y: 1 }, // Chip 0 (物理左上): 坐标设为 "1" (逻辑右)
  { x: -1, y: 1 }, // Chip 1 (物理右上): 坐标设为 "-1" (逻辑左)
  { x: 1, y: -1 }, // Chip 2 (物理左下): 坐标设为 "1" (逻辑右)
  { x: -1, y: -1 }, // Chip 3 (物理右下): 坐标设为 "-1" (逻辑左)
];

// ================== 新增：方向反转控制开关 ==================
// 如果发现X轴左右反了，请将此项改为 true
const INVERT_X = false;
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
    // console.log("开始零点校准...");
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
      // console.log(
      //   "✅ 零点基线采集完成!",
      //   this.zeroBaseline.map((v) => v.toArray())
      // );
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
      // console.warn("尚未校准，无法处理数据。");
      return null;
    }

    const currentVectors = this._packetToVectors(packet);

    // 1. 计算每个传感器的独立 Z 轴压力值 (权重)
    const weights = [];
    const delta = [];
    let totalWeight = 0;
    let maxWeight = 0;

    // 1. 计算每个传感器的变化向量和权重
    for (let i = 0; i < 4; i++) {
      // 计算该传感器的变化向量
      const d = currentVectors[i].clone().sub(this.zeroBaseline[i]);
      delta.push(d);

      // 取Z轴绝对值作为该传感器的压力权重
      // 这里可以加一个微小的死区或噪声过滤
      let w = Math.abs(d.z);
      if (w < 2.0) w = 0; // 过滤掉底噪

      weights.push(w);
      totalWeight += w;
      if (w > maxWeight) maxWeight = w;
    }

    // 2. 计算原始总压力值（用于后续处理）
    const rawZTotal = totalWeight / 4; // 取平均值作为总压力指标
    const z_amp_visual = THREE.MathUtils.clamp(rawZTotal / ADC_FULL, 0, 1);

    // 如果总压力太小，视为无操作
    if (z_amp_visual < PRESS_THR) {
      // 即使无操作，也记录数据（零值），保持图表连续性
      this.rawChartDataBuffer.push({ x: 0, y: 0, z: 0 });
      const CALIBRATION_FACTOR = 0.263;
      this.forceChartDataBuffer.push(0);
      return { x: 0, y: 0, intensity: 0 };
    }

    // 3. ================== 核心升级：重心法计算坐标 ==================
    let weightedX = 0;
    let weightedY = 0;

    for (let i = 0; i < 4; i++) {
      const w = weights[i];
      // 简单的线性加权：根据传感器位置和权重计算加权坐标
      weightedX += SENSOR_POSITIONS[i].x * w;
      weightedY += SENSOR_POSITIONS[i].y * w;
    }

    // 归一化坐标：将加权坐标除以总权重，得到归一化的位置 (-1 到 1)
    let x_pos = totalWeight > 0 ? weightedX / totalWeight : 0;
    let y_pos = totalWeight > 0 ? weightedY / totalWeight : 0;

    // 翻转修正 (保留之前的逻辑)
    if (INVERT_X) x_pos = -x_pos;
    if (INVERT_Y) y_pos = -y_pos;

    // 限制范围
    x_pos = THREE.MathUtils.clamp(x_pos, -1, 1);
    y_pos = THREE.MathUtils.clamp(y_pos, -1, 1);
    // ==========================================================

    // 4. 计算 X, Y, Z 三轴的原始数据值（用于图表显示）
    // X 和 Y 轴：使用归一化后的位置坐标
    // Z 轴：使用归一化后的压力值
    const x_amp = x_pos; // X 轴数据：位置坐标 (-1 到 1)
    const y_amp = y_pos; // Y 轴数据：位置坐标 (-1 到 1)
    const z_amp = z_amp_visual; // Z 轴数据：压力值 (0 到 1)

    // 5. 将三轴数据作为对象推入图表缓冲区
    this.rawChartDataBuffer.push({
      x: x_amp,
      y: y_amp,
      z: z_amp,
    });

    // 6. 计算标定后的力值（用于力值图表）
    const CALIBRATION_FACTOR = 0.263;
    const forceValue = rawZTotal * CALIBRATION_FACTOR;
    this.forceChartDataBuffer.push(forceValue);

    // 强度计算保持不变，或者使用 maxWeight 来表示峰值强度
    const intensity_raw = (z_amp_visual - PRESS_THR) / (1 - PRESS_THR);
    const z_gain = 3.5;
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

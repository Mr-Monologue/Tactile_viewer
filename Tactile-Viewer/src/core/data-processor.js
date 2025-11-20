import * as THREE from "three";

// 硬件映射常量：来自 Python 参考实现，确保数据转换一致
const AXIS_ORDER = [0, 1, 2];
const SIGN_VEC = new THREE.Vector3(-1, -1, -1);
const CHIP_MAP = [0, 1, 2, 3];
const ADC_FULL = 80.0;
const PRESS_THR = 0.01;

// 传感器空间布局：假设 4 个传感器按 2x2 网格排列，用于重心法计算位置
const SENSOR_POSITIONS = [
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: -1 },
];

// 坐标轴反转开关：用于硬件安装方向不同时的校准
const INVERT_X = false;
const INVERT_Y = false;

export class DataProcessor {
  constructor(options = {}) {
    this.zeroBaseline = null;
    this.zeroSum = new Array(4).fill(null).map(() => new THREE.Vector3());
    this.zeroCount = 0;
    this.zeroFrames = options.zeroFrames || 10;
    this.isCalibrating = false;
    this.rawChartDataBuffer = [];
    this.forceChartDataBuffer = [];
  }

  // 校准逻辑：采集多帧数据取平均作为零点基线，减少噪声影响
  startCalibration() {
    this.zeroBaseline = null;
    this.zeroSum.forEach((v) => v.set(0, 0, 0));
    this.zeroCount = 0;
    this.isCalibrating = true;
  }

  // 校准数据累积：收集指定帧数后计算平均值，返回 true 表示校准完成
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
      return true;
    }
    return false;
  }

  // 数据转换：将 12 个浮点数（4 个传感器 × 3 轴）转换为 4 个 Vector3
  // 关键假设：数据按 [sensor0_xyz, sensor1_xyz, sensor2_xyz, sensor3_xyz] 顺序排列
  _packetToVectors(packet) {
    const raw = [
      new THREE.Vector3().fromArray(packet, 0),
      new THREE.Vector3().fromArray(packet, 3),
      new THREE.Vector3().fromArray(packet, 6),
      new THREE.Vector3().fromArray(packet, 9),
    ];

    const mapped = CHIP_MAP.map((i) => raw[i]);

    // 应用轴顺序映射和符号翻转：确保与硬件坐标系一致
    const vectors = mapped.map((v) =>
      new THREE.Vector3(
        v.getComponent(AXIS_ORDER[0]),
        v.getComponent(AXIS_ORDER[1]),
        v.getComponent(AXIS_ORDER[2])
      ).multiply(SIGN_VEC)
    );

    return vectors;
  }

  // 数据处理核心：使用重心法计算按压位置，基于 4 个传感器的压力权重
  // 算法假设：每个传感器的 Z 轴压力代表该位置的权重，位置由传感器空间布局决定
  process(packet) {
    if (!this.zeroBaseline) {
      return null;
    }

    const currentVectors = this._packetToVectors(packet);

    // 1. 计算每个传感器的压力权重（Z 轴变化量的绝对值）
    const weights = [];
    const delta = [];
    let totalWeight = 0;
    let maxWeight = 0;

    for (let i = 0; i < 4; i++) {
      const d = currentVectors[i].clone().sub(this.zeroBaseline[i]);
      delta.push(d);

      let w = Math.abs(d.z);
      if (w < 2.0) w = 0; // 噪声过滤：低于阈值视为无压力

      weights.push(w);
      totalWeight += w;
      if (w > maxWeight) maxWeight = w;
    }

    // 2. 计算总压力值（用于图表和阈值判断）
    const rawZTotal = totalWeight / 4;
    const z_amp_visual = THREE.MathUtils.clamp(rawZTotal / ADC_FULL, 0, 1);

    if (z_amp_visual < PRESS_THR) {
      // 无操作时也记录零值，保持图表连续性
      this.rawChartDataBuffer.push({ x: 0, y: 0, z: 0 });
      const CALIBRATION_FACTOR = 0.263;
      this.forceChartDataBuffer.push(0);
      return { x: 0, y: 0, intensity: 0 };
    }

    // 3. 重心法计算位置：加权平均传感器位置，权重为各传感器压力
    let weightedX = 0;
    let weightedY = 0;

    for (let i = 0; i < 4; i++) {
      const w = weights[i];
      weightedX += SENSOR_POSITIONS[i].x * w;
      weightedY += SENSOR_POSITIONS[i].y * w;
    }

    // 归一化：除以总权重得到 -1 到 1 的坐标范围
    let x_pos = totalWeight > 0 ? weightedX / totalWeight : 0;
    let y_pos = totalWeight > 0 ? weightedY / totalWeight : 0;

    // 应用反转修正
    if (INVERT_X) x_pos = -x_pos;
    if (INVERT_Y) y_pos = -y_pos;

    x_pos = THREE.MathUtils.clamp(x_pos, -1, 1);
    y_pos = THREE.MathUtils.clamp(y_pos, -1, 1);

    // 4. 准备图表数据：X/Y 为位置坐标，Z 为压力值
    this.rawChartDataBuffer.push({
      x: x_pos,
      y: y_pos,
      z: z_amp_visual,
    });

    // 5. 计算标定后的力值：使用经验标定因子转换为牛顿
    const CALIBRATION_FACTOR = 0.263;
    const forceValue = rawZTotal * CALIBRATION_FACTOR;
    this.forceChartDataBuffer.push(forceValue);

    // 6. 强度计算：非线性映射，使用增益系数增强响应
    const intensity_raw = (z_amp_visual - PRESS_THR) / (1 - PRESS_THR);
    const z_gain = 3.5;
    const intensity = Math.min(intensity_raw * z_gain, 1.0);

    return {
      x: x_pos,
      y: y_pos,
      intensity: intensity,
    };
  }

  // 数据缓冲区管理：批量读取并清空，减少锁竞争
  getAndClearChartData() {
    if (this.rawChartDataBuffer.length === 0) return {};
    const rawData = [...this.rawChartDataBuffer];
    const forceData = [...this.forceChartDataBuffer];
    this.rawChartDataBuffer = [];
    this.forceChartDataBuffer = [];
    return { rawData, forceData };
  }
}

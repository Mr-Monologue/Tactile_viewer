import * as THREE from "three";

// 复制Python代码中的核心常量
const AXIS_ORDER = [0, 1, 2];
const SIGN_VEC = new THREE.Vector3(-1, -1, -1);
const CHIP_MAP = [0, 1, 2, 3]; // JS数组索引从0开始

const ADC_FULL = 80.0;
const PRESS_THR = 0.01;

// ================== 新增：方向反转控制开关 ==================
// 如果您发现X轴左右反了，请将此项改为 true
const INVERT_X = true;
// 如果您发现Y轴上下反了，请将此项改为 true
const INVERT_Y = false; // 根据Python代码，Y轴很可能需要反转
// ==========================================================

export class DataProcessor {
  constructor(options = {}) {
    this.zeroBaseline = null;
    this.zeroSum = new Array(4).fill(null).map(() => new THREE.Vector3());
    this.zeroCount = 0;
    this.zeroFrames = options.zeroFrames || 10;
    this.isCalibrating = false;
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
    const delta = currentVectors.map((v, i) =>
      v.clone().sub(this.zeroBaseline[i])
    );
    const vecTotal = delta
      .reduce((sum, v) => sum.add(v), new THREE.Vector3())
      .multiplyScalar(1 / 4);

    let x_pos = THREE.MathUtils.clamp(vecTotal.x / ADC_FULL, -1, 1);
    let y_pos = THREE.MathUtils.clamp(vecTotal.y / ADC_FULL, -1, 1);

    if (INVERT_X) x_pos = -x_pos;
    if (INVERT_Y) y_pos = -y_pos;

    const z_amp_raw = THREE.MathUtils.clamp(
      Math.abs(vecTotal.z) / ADC_FULL,
      0,
      1
    );

    if (z_amp_raw < PRESS_THR) {
      return { x: x_pos, y: y_pos, intensity: 0 }; // 注意：即使强度为0，也把xy传出去
    }

    const intensity_raw = (z_amp_raw - PRESS_THR) / (1 - PRESS_THR);

    // ================== 修改：增加强度增益 ==================
    const z_gain = 2.5; // <--- 您可以随时调整这个“力度放大”系数
    const intensity = Math.min(intensity_raw * z_gain, 1.0); // 放大后要截断
    // =======================================================

    return {
      x: x_pos,
      y: y_pos,
      intensity: intensity,
    };
  }
}

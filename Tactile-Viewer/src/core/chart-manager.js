import { Chart, registerables } from "chart.js";
Chart.register(...registerables);

const MAX_DATA_POINTS = 100;

// 图表配置工厂：统一配置生成逻辑，避免重复代码
function createChartConfig(ctx, label, color, yMin, yMax) {
  // 渐变背景：从传入颜色提取 RGB 并添加透明度渐变
  const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
  const colorBase = color.replace(/[\d.]+\)$/g, "");
  gradient.addColorStop(0, `${colorBase} 0.4)`);
  gradient.addColorStop(1, `${colorBase} 0)`);

  return {
    type: "line",
    data: {
      labels: new Array(MAX_DATA_POINTS).fill(""),
      datasets: [
        {
          label: label,
          data: new Array(MAX_DATA_POINTS).fill(0),
          borderColor: color,
          backgroundColor: gradient,
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { display: false },
        y: {
          min: yMin,
          max: yMax,
          ticks: { color: "#9ca3af", font: { size: 9 } },
          grid: { color: "rgba(255, 255, 255, 0.05)" },
        },
      },
      plugins: { legend: { display: false } },
      animation: { duration: 0 }, // 禁用动画以提升性能
    },
  };
}

export class ChartManager {
  constructor(ids, options = {}) {
    const ctxX = document.getElementById(ids.x).getContext("2d");
    const ctxY = document.getElementById(ids.y).getContext("2d");
    const ctxZ = document.getElementById(ids.z).getContext("2d");
    const ctxF = document.getElementById(ids.f).getContext("2d");

    // 初始化 4 个独立图表：X/Y 轴范围 -1~1（位置坐标），Z 轴 0~0.6（压力值），力值 0~12N
    this.chartX = new Chart(
      ctxX,
      createChartConfig(ctxX, "X", "rgba(255, 82, 82, 1)", -1.0, 1.0)
    );

    this.chartY = new Chart(
      ctxY,
      createChartConfig(ctxY, "Y", "rgba(105, 240, 174, 1)", -1.0, 1.0)
    );

    this.chartZ = new Chart(
      ctxZ,
      createChartConfig(
        ctxZ,
        "Z",
        "rgba(68, 138, 255, 1)",
        0,
        options.rawMax || 0.6
      )
    );

    this.chartF = new Chart(
      ctxF,
      createChartConfig(
        ctxF,
        "Force",
        "rgba(255, 195, 0, 1)",
        0,
        options.forceMax || 12.0
      )
    );
  }

  // 单图表更新：使用滑动窗口保持固定数据点数
  _updateSingleChart(chart, newDataArray) {
    if (!newDataArray || newDataArray.length === 0) return;
    const data = chart.data.datasets[0].data;

    for (let val of newDataArray) {
      data.push(val);
      if (data.length > MAX_DATA_POINTS) data.shift();
    }
    chart.update("none");
  }

  // 统一更新接口：拆分对象数组到各轴，进行数据清洗（防止 NaN）
  updateCharts(rawArray, forceArray) {
    if (!rawArray || rawArray.length === 0) return;

    const xData = [],
      yData = [],
      zData = [];
    for (let item of rawArray) {
      xData.push(item && !isNaN(item.x) ? item.x : 0);
      yData.push(item && !isNaN(item.y) ? item.y : 0);
      zData.push(item && !isNaN(item.z) ? item.z : 0);
    }

    this._updateSingleChart(this.chartX, xData);
    this._updateSingleChart(this.chartY, yData);
    this._updateSingleChart(this.chartZ, zData);
    this._updateSingleChart(this.chartF, forceArray);
  }
}

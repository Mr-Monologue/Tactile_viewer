import { Chart, registerables } from "chart.js";
Chart.register(...registerables);

const MAX_DATA_POINTS = 100;

// ================== 升级：创建带渐变填充的图表配置 ==================
function createChartConfig(ctx, label, color, yMin, yMax) {
  // 创建线性渐变
  const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
  gradient.addColorStop(0, `${color}60`); // 顶部颜色 (38% 透明度)
  gradient.addColorStop(0.8, `${color}10`); // 中下部颜色 (6% 透明度)
  gradient.addColorStop(1, `${color}00`); // 底部完全透明

  return {
    type: "line",
    data: {
      labels: new Array(MAX_DATA_POINTS).fill(""),
      datasets: [
        {
          label: label,
          data: new Array(MAX_DATA_POINTS).fill(0),
          borderColor: color, // 使用新的活力颜色
          backgroundColor: gradient, // 应用渐变
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
          ticks: { color: "#9ca3af", font: { size: 10 } },
          grid: {
            color: "rgba(255, 255, 255, 0.05)", // 网格线调得更暗
          },
        },
      },
      plugins: {
        legend: { display: false },
      },
      animation: { duration: 0 },
    },
  };
}

export class ChartManager {
  constructor(rawCanvasId, forceCanvasId, options = {}) {
    const rawCtx = document.getElementById(rawCanvasId).getContext("2d");
    const forceCtx = document.getElementById(forceCanvasId).getContext("2d");

    // ================== 升级：使用新的活力颜色 ==================
    const vibrantGreen = "#00ff9d"; // 活力薄荷绿
    const vibrantAmber = "#ffc300"; // 活力琥珀色

    this.rawChart = new Chart(
      rawCtx,
      createChartConfig(
        rawCtx,
        "原始值",
        vibrantGreen,
        0,
        options.rawMax || 1.0
      )
    );

    this.forceChart = new Chart(
      forceCtx,
      createChartConfig(
        forceCtx,
        "力值 (N)",
        vibrantAmber,
        0,
        options.forceMax || 12.0
      )
    );
  }

  _updateChart(chart, newDataArray) {
    if (!newDataArray || newDataArray.length === 0) return;
    const data = chart.data.datasets[0].data;
    data.push(...newDataArray);
    if (data.length > MAX_DATA_POINTS) {
      data.splice(0, data.length - MAX_DATA_POINTS);
    }
    chart.update("none"); // 'none' 参数可以获得更快的实时更新
  }

  updateRawChart(newDataArray) {
    this._updateChart(this.rawChart, newDataArray);
  }

  updateForceChart(newDataArray) {
    this._updateChart(this.forceChart, newDataArray);
  }
}

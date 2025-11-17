import { Chart, registerables } from "chart.js";
Chart.register(...registerables);

const MAX_DATA_POINTS = 100;

// ================== 修改：接收 min/max 配置 ==================
function createChartConfig(label, borderColor, backgroundColor, yMin, yMax) {
  return {
    type: "line",
    data: {
      labels: new Array(MAX_DATA_POINTS).fill(""),
      datasets: [
        {
          label: label,
          data: new Array(MAX_DATA_POINTS).fill(0),
          borderColor: borderColor,
          backgroundColor: backgroundColor,
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
          // ================== 应用固定的Y轴范围 ==================
          min: yMin,
          max: yMax,
          // =======================================================
          ticks: { color: "#9ca3af", font: { size: 10 } },
          grid: { color: "rgba(255, 255, 255, 0.1)" },
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

    // ================== 修改：传入Y轴范围 ==================
    this.rawChart = new Chart(
      rawCtx,
      createChartConfig(
        "原始值",
        "#4ade80",
        "rgba(74, 222, 128, 0.2)",
        0, // min
        options.rawMax || 1.0 // max
      )
    );

    this.forceChart = new Chart(
      forceCtx,
      createChartConfig(
        "力值 (N)",
        "#f59e0b",
        "rgba(245, 158, 11, 0.2)",
        0, // min
        options.forceMax || 12.0 // max
      )
    );
    // ====================================================
  }

  _updateChart(chart, newDataArray) {
    if (!newDataArray || newDataArray.length === 0) return;
    const data = chart.data.datasets[0].data;
    data.push(...newDataArray);
    if (data.length > MAX_DATA_POINTS) {
      data.splice(0, data.length - MAX_DATA_POINTS);
    }
    chart.update();
  }

  updateRawChart(newDataArray) {
    this._updateChart(this.rawChart, newDataArray);
  }

  updateForceChart(newDataArray) {
    this._updateChart(this.forceChart, newDataArray);
  }

  // 统一更新方法，接收包含 rawData 和 forceData 的对象
  update(data) {
    if (!data || typeof data !== "object") return;
    if (data.rawData) this.updateRawChart(data.rawData);
    if (data.forceData) this.updateForceChart(data.forceData);
  }
}

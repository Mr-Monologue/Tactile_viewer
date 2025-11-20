import { Chart, registerables } from "chart.js";
Chart.register(...registerables);

const MAX_DATA_POINTS = 100;

// 通用图表配置生成器
function createChartConfig(ctx, label, color, yMin, yMax) {
  // 创建渐变背景
  const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);

  // 简单的颜色转换辅助函数 (Hex/RGB -> RGBA)
  // 为了简单起见，这里假设传入的是 RGBA 字符串或者标准颜色名，我们手动拼接透明度
  // 或者我们可以直接在调用时传入基础色，这里简单处理一下

  // 这是一个更通用的渐变生成逻辑
  // 我们假设传入的 color 是类似 'rgba(255, 0, 0, 1)' 的格式
  // 简单的替换 alpha 值
  const colorBase = color.replace(/[\d.]+\)$/g, ""); // 移除最后的透明度部分 '1)'

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
          tension: 0.4, // 平滑曲线
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
          ticks: { color: "#9ca3af", font: { size: 9 } }, // 字体稍微改小一点
          grid: { color: "rgba(255, 255, 255, 0.05)" },
        },
      },
      plugins: { legend: { display: false } },
      animation: { duration: 0 },
    },
  };
}

export class ChartManager {
  constructor(ids, options = {}) {
    // ids = { x: 'id', y: 'id', z: 'id', f: 'id' }

    const ctxX = document.getElementById(ids.x).getContext("2d");
    const ctxY = document.getElementById(ids.y).getContext("2d");
    const ctxZ = document.getElementById(ids.z).getContext("2d");
    const ctxF = document.getElementById(ids.f).getContext("2d");

    // X轴: 红色 (-1 ~ 1)
    this.chartX = new Chart(
      ctxX,
      createChartConfig(ctxX, "X", "rgba(255, 82, 82, 1)", -1.0, 1.0)
    );

    // Y轴: 绿色 (-1 ~ 1)
    this.chartY = new Chart(
      ctxY,
      createChartConfig(ctxY, "Y", "rgba(105, 240, 174, 1)", -1.0, 1.0)
    );

    // Z轴: 蓝色 (0 ~ 1, 原始值)
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

    // 力值: 琥珀色 (0 ~ 12)
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

  _updateSingleChart(chart, newDataArray) {
    if (!newDataArray || newDataArray.length === 0) return;
    const data = chart.data.datasets[0].data;

    // 批量推入数据
    for (let val of newDataArray) {
      data.push(val);
      if (data.length > MAX_DATA_POINTS) data.shift();
    }
    chart.update("none");
  }

  updateCharts(rawArray, forceArray) {
    if (!rawArray || rawArray.length === 0) return;

    // 1. 准备数据数组
    const xData = [],
      yData = [],
      zData = [];
    for (let item of rawArray) {
      // 数据清洗，防止 NaN
      xData.push(item && !isNaN(item.x) ? item.x : 0);
      yData.push(item && !isNaN(item.y) ? item.y : 0);
      zData.push(item && !isNaN(item.z) ? item.z : 0);
    }

    // 2. 分别更新
    this._updateSingleChart(this.chartX, xData);
    this._updateSingleChart(this.chartY, yData);
    this._updateSingleChart(this.chartZ, zData);

    // 3. 更新力值
    this._updateSingleChart(this.chartF, forceArray);
  }
}

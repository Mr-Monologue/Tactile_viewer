import * as THREE from "three";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";

// 触觉可视化层：在 3D 模型表面生成六角网格点云，并根据传感器数据实时更新颜色和强度
export class TactileLayer {
  constructor(scene, parentMesh, options = {}) {
    this.scene = scene;
    this.mesh = parentMesh;
    this.spacing = options.spacing ?? 0.05;
    const maxPoints = options.maxPoints ?? 8000;

    // 实例化网格：使用 Billboard 技术（面片始终面向相机），提升性能和视觉效果
    this.attrCol = new THREE.BufferAttribute(
      new Float32Array(maxPoints * 3),
      3
    );
    this.attrInt = new THREE.BufferAttribute(new Float32Array(maxPoints), 1);

    const diskPlane = new THREE.PlaneGeometry(1, 1);
    const diskVertex = `attribute float radius;attribute float intensity;attribute vec3 nrmW;uniform vec3 camRight;uniform vec3 camUp;uniform float pushW;varying vec2 vUv;varying vec3 vColor;void main(){vUv=uv;vColor=color;vec3 center=(instanceMatrix*vec4(0.,0.,0.,1.)).xyz+normalize(nrmW)*pushW;float R=radius*(1.+.9*intensity);vec2 quad=(uv-.5)*(2.*R);vec3 pos=center+camRight*quad.x+camUp*quad.y;gl_Position=projectionMatrix*viewMatrix*vec4(pos,1.);}`;
    const diskFragment = `varying vec2 vUv;varying vec3 vColor;void main(){vec2 p=vUv*2.-1.;if(dot(p,p)>1.)discard;gl_FragColor=vec4(vColor,1.);}`;
    this.matDisks = new THREE.ShaderMaterial({
      vertexColors: !0,
      transparent: !1,
      depthTest: !0,
      depthWrite: !0,
      uniforms: {
        camRight: { value: new THREE.Vector3(1, 0, 0) },
        camUp: { value: new THREE.Vector3(0, 1, 0) },
        pushW: { value: 0 },
      },
      vertexShader: diskVertex,
      fragmentShader: diskFragment,
    });

    this.disks = new THREE.InstancedMesh(diskPlane, this.matDisks, maxPoints);
    this.disks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const radiiArr = new Float32Array(maxPoints);
    const nrmArr = new Float32Array(maxPoints * 3);
    this.disks.geometry.setAttribute(
      "radius",
      new THREE.InstancedBufferAttribute(radiiArr, 1)
    );
    this.disks.geometry.setAttribute(
      "intensity",
      new THREE.InstancedBufferAttribute(this.attrInt.array, 1)
    );
    this.disks.geometry.setAttribute(
      "nrmW",
      new THREE.InstancedBufferAttribute(nrmArr, 3)
    );
    this.disks.geometry.setAttribute(
      "color",
      new THREE.InstancedBufferAttribute(this.attrCol.array, 3)
    );
    this.disks.renderOrder = 2;
    this.scene.add(this.disks);

    this.running = true;
    this.finalPoints = [];

    this.pressCenter = null;
    this.pressIntensity = 0.0;
    this.animationState = "IDLE";
    this.stateTimer = 2.0;
    this.originalColor = new THREE.Color(0x1affc2);
    this.pressColorMid = new THREE.Color(0xffa500);
    this.pressColorEnd = new THREE.Color(0xff1111);
    this.tempColor = new THREE.Color();
  }

  dispose() {
    /* ... */
  }

  // 六角网格生成：使用射线检测在模型表面采样，形成均匀的六角排列
  // 关键假设：模型表面法向量指向相机方向，以此构建 UV 坐标系
  async generateHexGrid(camera) {
    console.time("Hex Grid Generation");
    document.getElementById("info").textContent = "正在生成六角网格...";
    await new Promise((r) => setTimeout(r, 20));

    this.mesh.updateWorldMatrix(true, true);
    const meshes = [];
    this.mesh.traverse((o) => {
      if (o.isMesh && o.geometry?.attributes?.position) meshes.push(o);
    });
    if (!meshes.length) return;

    // 合并所有子网格为单一几何体，简化射线检测
    const geos = meshes.map((m) =>
      m.geometry.clone().applyMatrix4(m.matrixWorld)
    );
    const merged = BufferGeometryUtils.mergeGeometries(geos, false);
    if (!merged) return;

    merged.computeBoundsTree();
    const targetMesh = new THREE.Mesh(merged);

    // 采样顶点以确定网格范围：每 3000 个顶点采样一个，平衡精度与性能
    const verts = [];
    const posAttr = merged.getAttribute("position");
    const step = Math.max(1, Math.ceil(posAttr.count / 3000));
    for (let i = 0; i < posAttr.count; i += step) {
      verts.push(new THREE.Vector3().fromBufferAttribute(posAttr, i));
    }

    const center = verts
      .reduce((a, b) => a.add(b), new THREE.Vector3())
      .multiplyScalar(1 / verts.length);

    // 计算表面法向量：使用从相机到中心的射线检测第一个交点
    const raycasterForNormal = new THREE.Raycaster();
    const toCam = camera.position.clone().sub(center).normalize();
    raycasterForNormal.set(camera.position, toCam.clone().negate());
    const hitForNormal = raycasterForNormal.intersectObject(
      targetMesh,
      false
    )[0];
    const normal = hitForNormal
      ? hitForNormal.face.normal
          .clone()
          .transformDirection(targetMesh.matrixWorld)
      : new THREE.Vector3(0, 0, 1);

    // 构建 UV 坐标系：U 和 V 垂直于法向量，形成切平面
    let U = new THREE.Vector3(1, 0, 0);
    if (Math.abs(normal.x) > 0.9) U.set(0, 1, 0);
    U.sub(normal.clone().multiplyScalar(U.dot(normal))).normalize();
    const V = new THREE.Vector3().crossVectors(normal, U).normalize();

    // 计算网格边界
    let umin = Infinity,
      umax = -Infinity,
      vmin = Infinity,
      vmax = -Infinity;
    verts.forEach((p) => {
      const d = p.clone().sub(center);
      const u = d.dot(U);
      const v = d.dot(V);
      if (u < umin) umin = u;
      if (u > umax) umax = u;
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    });

    const pad = this.spacing * 1.5;
    umin -= pad;
    umax += pad;
    vmin -= pad;
    vmax += pad;

    // 六角网格参数：水平间距 du，垂直间距 dv = du * sqrt(3) / 2（六角网格特性）
    const du = this.spacing;
    const dv = this.spacing * Math.sqrt(3) * 0.5;

    const raycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = true;

    // 射线起点偏移：从表面外侧向内投射，避免边界问题
    const diag =
      new THREE.Box3()
        .setFromObject(this.mesh)
        .getSize(new THREE.Vector3())
        .length() || 1;
    const pushOut = Math.max(1e-4, diag * 0.1);

    const chosen = [];
    const maxInstances = this.disks.count;
    const tmpN = new THREE.Vector3();

    // 六角网格采样：奇偶行错位（uOffset），形成六角排列
    for (let row = 0, v_coord = vmin; v_coord <= vmax; row++, v_coord += dv) {
      const uOffset = row % 2 ? du * 0.5 : 0;
      for (let u_coord = umin + uOffset; u_coord <= umax; u_coord += du) {
        const origin = center
          .clone()
          .addScaledVector(U, u_coord)
          .addScaledVector(V, v_coord)
          .addScaledVector(normal, pushOut);
        raycaster.set(origin, normal.clone().multiplyScalar(-1));
        const hit = raycaster.intersectObject(targetMesh, false)[0];
        if (hit) {
          tmpN
            .copy(hit.face.normal)
            .transformDirection(targetMesh.matrixWorld)
            .normalize();

          // UV 坐标映射：注意 u 和 v 的对应关系（X↔V, Y↔U）
          chosen.push({
            pos: hit.point.clone(),
            nrm: tmpN.clone(),
            v: (u_coord - umin) / (umax - umin),
            u: (v_coord - vmin) / (vmax - vmin),
          });

          if (chosen.length >= maxInstances) break;
        }
      }
      if (chosen.length >= maxInstances) break;
    }

    targetMesh.geometry.disposeBoundsTree();
    targetMesh.geometry.dispose();
    this.finalPoints = chosen;
    this.updateInstances();

    console.timeEnd("Hex Grid Generation");
    document.getElementById(
      "info"
    ).innerHTML = `✅ 六角网格 | 间距=${this.spacing.toFixed(
      4
    )} | 点数 <span class="num">${chosen.length}</span>`;
  }

  updateInstances() {
    const count = this.finalPoints.length;
    const bbox = new THREE.Box3().setFromObject(this.mesh);

    this.attrInt.array.fill(0);
    const colArr = this.attrCol.array;
    const nrmArr = this.disks.geometry.getAttribute("nrmW").array;
    for (let i = 0; i < count; i++) {
      this.originalColor.toArray(colArr, i * 3);
      this.finalPoints[i].nrm.toArray(nrmArr, i * 3);
    }

    const M = new THREE.Matrix4();
    const radii = this.disks.geometry.getAttribute("radius").array;
    const baseR = this.spacing * 0.22;
    this.matDisks.uniforms.pushW.value = this.spacing * 0.3;

    for (let i = 0; i < count; i++) {
      M.makeTranslation(
        this.finalPoints[i].pos.x,
        this.finalPoints[i].pos.y,
        this.finalPoints[i].pos.z
      );
      this.disks.setMatrixAt(i, M);
      radii[i] = baseR;
    }
    for (let i = count; i < radii.length; i++) radii[i] = 0;

    this.disks.count = count;
    this.disks.instanceMatrix.needsUpdate = true;
    this.disks.geometry.getAttribute("radius").needsUpdate = true;
    this.disks.geometry.getAttribute("nrmW").needsUpdate = true;
    this.disks.geometry.getAttribute("color").needsUpdate = true;
    this._center = bbox.getCenter(new THREE.Vector3());
  }

  // 传感器数据映射：将归一化的传感器坐标 (-1~1) 映射到网格的 UV 坐标 (0~1)
  // 使用最近邻查找：假设传感器坐标与网格 UV 坐标线性对应
  updateFromSensorData(sensorX, sensorY, intensity) {
    if (this.finalPoints.length === 0) return;

    const x_gain = 1.2;
    const y_gain = 1.2;

    const u = (sensorX * x_gain + 1) / 2;
    const v = (sensorY * y_gain + 1) / 2;

    let closestPoint = null;
    let minDistanceSq = Infinity;

    for (const point of this.finalPoints) {
      const dx = point.u - u;
      const dy = point.v - v;
      const distSq = dx * dx + dy * dy;
      if (distSq < minDistanceSq) {
        minDistanceSq = distSq;
        closestPoint = point;
      }
    }

    if (closestPoint) {
      this.pressCenter = closestPoint.pos;
      this.pressIntensity = intensity;
    } else {
      this.pressCenter = null;
      this.pressIntensity = 0;
    }
  }

  // 视觉更新：基于按压中心计算每个点的颜色和强度，使用指数衰减模拟压力扩散
  updateVisuals(dt) {
    if (this.animationState) this._updatePressAnimation(dt);
    if (this.finalPoints.length === 0) return;
    const colArr = this.attrCol.array;
    const intensArr = this.attrInt.array;
    if (!this.pressCenter || this.pressIntensity <= 0) {
      for (let k = 0; k < this.finalPoints.length; k++) {
        this.originalColor.toArray(colArr, k * 3);
        intensArr[k] = 0;
      }
    } else {
      // 影响半径：设为 15 倍点间距，确保压力效果可见
      const pressRadius = this.spacing * 15;
      const pressRadiusSq = pressRadius * pressRadius;
      for (let k = 0; k < this.finalPoints.length; k++) {
        const point = this.finalPoints[k];
        const distSq = point.pos.distanceToSquared(this.pressCenter);
        // 指数衰减：exp(-4*d²/r²)，系数 -4 控制衰减速度
        const falloff = Math.exp((-4 * distSq) / pressRadiusSq);
        const influence = falloff * this.pressIntensity;
        // 颜色插值：低强度时绿→橙，高强度时橙→红
        if (influence < 0.5) {
          this.tempColor
            .copy(this.originalColor)
            .lerp(this.pressColorMid, influence * 2);
        } else {
          this.tempColor
            .copy(this.pressColorMid)
            .lerp(this.pressColorEnd, (influence - 0.5) * 2);
        }
        this.tempColor.toArray(colArr, k * 3);
        intensArr[k] = influence;
      }
    }
    this.disks.geometry.getAttribute("color").needsUpdate = !0;
    this.disks.geometry.getAttribute("intensity").needsUpdate = !0;
  }

  // 自动演示动画：未连接设备时播放随机按压动画，展示系统能力
  _updatePressAnimation(dt) {
    this.stateTimer -= dt;
    switch (this.animationState) {
      case "IDLE":
        if (this.stateTimer <= 0) {
          if (this.finalPoints.length === 0) return;
          const randomIndex = Math.floor(
            Math.random() * this.finalPoints.length
          );
          this.pressCenter = this.finalPoints[randomIndex].pos;
          this.animationState = "PRESSING";
          this.stateTimer = 0.5;
        }
        break;
      case "PRESSING":
        this.pressIntensity = 1 - this.stateTimer / 0.5;
        if (this.stateTimer <= 0) {
          this.pressIntensity = 1;
          this.animationState = "HOLDING";
          this.stateTimer = 1;
        }
        break;
      case "HOLDING":
        if (this.stateTimer <= 0) {
          this.animationState = "RELEASING";
          this.stateTimer = 1;
        }
        break;
      case "RELEASING":
        this.pressIntensity = this.stateTimer / 1;
        if (this.stateTimer <= 0) {
          this.pressIntensity = 0;
          this.pressCenter = null;
          this.animationState = "IDLE";
          this.stateTimer = Math.random() * 2 + 1;
        }
        break;
    }
  }
}

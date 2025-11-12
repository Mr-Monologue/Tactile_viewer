import * as THREE from 'three';

export function frameToObject(camera, controls, obj, padding = 1.15) {
    const box = new THREE.Box3().setFromObject(obj);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const center = sphere.center;
    const radius = Math.max(1e-6, sphere.radius);
    const vFov = camera.fov * Math.PI / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov * 0.5) * camera.aspect);
    const fov = Math.min(vFov, hFov);
    const dist = radius / Math.sin(fov * 0.5) * padding;
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    let dir;
    if (maxDim === size.y) dir = new THREE.Vector3(0.8, 0.4, 0.8);
    else if (maxDim === size.x) dir = new THREE.Vector3(0.6, 0.6, 1);
    else dir = new THREE.Vector3(1, 0.6, 1);
    camera.position.copy(center).addScaledVector(dir.normalize(), dist);
    camera.near = Math.max(dist - radius * 3, 0.001);
    camera.far = dist + radius * 10;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
}

export function mapAxes(obj, map) {
    const pick = s => {
        switch (s) {
            case '+x': return new THREE.Vector3(1, 0, 0); case '-x': return new THREE.Vector3(-1, 0, 0);
            case '+y': return new THREE.Vector3(0, 1, 0); case '-y': return new THREE.Vector3(0, -1, 0);
            case '+z': return new THREE.Vector3(0, 0, 1); case '-z': return new THREE.Vector3(0, 0, -1);
            default: return new THREE.Vector3(1, 0, 0);
        }
    };
    const Xw = pick(map.x), Yw = pick(map.y), Zw = pick(map.z);
    const m = new THREE.Matrix4().makeBasis(Xw, Yw, Zw);
    obj.setRotationFromQuaternion(new THREE.Quaternion().setFromRotationMatrix(m));
}

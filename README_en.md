# GLB Tactile Demo

This project is a browser-based visualization tool built with Three.js. It loads GLB/GLTF models and generates a hexagonal tactile point cloud over a designated surface. The result is rendered with custom shaders so that each tactile sample appears as a camera-facing disk with dynamic coloring and intensity, ideal for rapid prototyping of tactile patches or sensor arrays.

## Features

- **GLB/GLTF loading** – Works with local files, including Draco- and Meshopt-compressed assets.
- **Hex-grid tactile sampling** – Automatically samples either the `touch_area` mesh or the whole model, adapting to the model scale.
- **Robust coverage** – Uses area-weighted normals, multi-directional ray casting, and BVH acceleration to reliably land points on the exterior surface.
- **Dynamic visualization** – Built-in animated scalar field demonstrates color/intensity waves across the points; replace with real data as needed.
- **Interactive UI** – Buttons for re-sampling, resetting the view, toggling auto-rotation, and switching background style.

## Getting Started

1. **Browser requirement** – Use a modern browser (Chrome/Edge 114+ recommended).
2. **Open the page** – Double-click `glb_viewer_tactile.html` or serve it from a local web server.
3. **Load a model** – Click “Choose GLB” to import `.glb`/`.gltf` files.
4. **Inspect the output** – The sampling runs automatically; the HUD shows point counts and triangle counts.
5. **Re-sample** – Use the “Re-sample” button to regenerate dots. Adjust `DEFAULT_HEX_SPACING` in code to change density.

## Controls

- **OrbitControls**: left drag to rotate, scroll to zoom, middle drag to pan.
- **UI toggles**:
  - `Re-sample`: regenerate the hex grid using the current spacing constant.
  - `Reset View`: frame the model again.
  - `Auto Rotate`: spin the camera automatically.
  - `Dark Background`: switch between dark/light environment; also toggles the ground grid.
- **HUD**: shows status messages and basic statistics (points, triangles).

## Hex Sampling Pipeline

1. **Geometry merge** – Prefer the `touch_area` mesh; fall back to the full scene.
2. **Local frame** – Compute an area-weighted world normal (`N`) and derive orthogonal tangents (`U/V`).
3. **UV bounds** – Project vertices to the local plane, estimate hex spacing, and scale to fit within the instancing limit.
4. **Fan casting** – Fire multiple rays (0°, ±12°, ±24°, ±45°, including diagonal axes) from an offset point outside the surface.
5. **Inside test fallback** – If the fan misses, perform axial ±N probes; if either hits, retry the fan with a closer origin.
6. **Instance write-back** – Store hit positions/normals in an `InstancedMesh` and set disk radius & separation according to model scale.

## Configuration Tips

- Default spacing: `DEFAULT_HEX_SPACING = 0.003`. Tweak this to match model units (meters vs. millimeters).
- Sampling parameters: adjust angles, push-off distances, or ray limits in `TactileLayer.resampleHexGrid()`.
- Visual encoding: `updateDemoScalar()` controls point colors and intensities; replace with live sensor data if desired.
- Depth debugging: temporarily set `matDisks.depthTest = false` to check for z-fighting issues.

## Dependencies

- `three@0.160.0`
- Three.js examples: `OrbitControls`, `GLTFLoader`, `DRACOLoader`, `RoomEnvironment`, `MeshoptDecoder`
- `three-mesh-bvh` for accelerated raycasts and closest-point queries

## FAQ

- **Sparse or missing points**: decrease spacing or enlarge fan angles / ray distance.
- **Dots hidden by geometry**: verify normals; try disabling depth test temporarily.
- **Interior hits**: ensure the intended surface has coherent outward normals (especially for `touch_area`).

Feel free to expand the UI, export routines, or data bindings to fit your tactile visualization workflow.

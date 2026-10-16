import { useEffect, useRef } from "react";
import type * as Three from "three";
import "./overview-backdrop.css";

const MODEL_URL = "/models/mac-campus-ff01.glb";
const ROTATION_PERIOD_MS = 120_000;
const FRAME_INTERVAL_MS = 1000 / 30;
const CAMERA_ELEVATION_DEGREES = 25;
const MODEL_ZOOM = 2;

function disposeModel(root: Three.Object3D) {
  const geometries = new Set<Three.BufferGeometry>();
  const materials = new Set<Three.Material>();
  const textures = new Set<Three.Texture>();
  root.traverse(object => {
    const mesh = object as Three.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const value of Object.values(material)) {
        const texture = value as Three.Texture | null;
        if (texture?.isTexture) textures.add(texture);
      }
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  textures.forEach(texture => {
    texture.dispose();
    if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) texture.image.close();
  });
}

/** Decorative, monochrome campus orbit behind the overview content. */
export default function OverviewBackdrop() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const controller = new AbortController();
    let disposed = false;
    let cleanupScene: (() => void) | undefined;
    container.dataset.state = "loading";

    void (async () => {
      const [THREE, { GLTFLoader }] = await Promise.all([
        import("three"),
        import("three/addons/loaders/GLTFLoader.js"),
      ]);
      if (disposed) return;
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "low-power" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
      renderer.setClearColor(0x191919, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute("aria-hidden", "true");
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 1000);
      camera.zoom = MODEL_ZOOM;
      const orbit = new THREE.Group();
      scene.add(orbit);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 2));
      const light = new THREE.DirectionalLight(0xffffff, 1.8);
      scene.add(light);
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      let model: Three.Object3D | null = null;
      let radius = 1;
      let frame = 0;
      let lastTick = 0;
      let lastRender = 0;
      let contextLost = false;

      const schedule = () => {
        if (!disposed && !frame && model && !document.hidden && !contextLost) frame = requestAnimationFrame(render);
      };
      const render = (now: number) => {
        frame = 0;
        if (disposed || document.hidden || contextLost || !model) return;
        if (now - lastRender < FRAME_INTERVAL_MS) { schedule(); return; }
        if (lastTick && !reducedMotion.matches) {
          orbit.rotation.y += Math.min(now - lastTick, 100) * Math.PI * 2 / ROTATION_PERIOD_MS;
          orbit.rotation.y %= Math.PI * 2;
        }
        lastTick = now;
        lastRender = now;
        renderer.render(scene, camera);
        if (!reducedMotion.matches) schedule();
      };
      const resize = () => {
        const width = container.clientWidth, height = container.clientHeight;
        if (!width || !height) return;
        const aspect = width / height;
        // Fit a bounding sphere so the complete model stays framed through its orbit.
        const halfHeight = radius * 1.05 / Math.min(aspect, 1);
        camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect;
        camera.top = halfHeight; camera.bottom = -halfHeight;
        camera.near = radius * .01; camera.far = radius * 12;
        // Elevation is measured down from the horizontal ground plane.
        camera.position.set(0, radius * 3 * Math.tan(THREE.MathUtils.degToRad(CAMERA_ELEVATION_DEGREES)), radius * 3);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
        lastRender = 0;
        schedule();
      };
      const onVisibility = () => {
        cancelAnimationFrame(frame); frame = 0; lastTick = 0; lastRender = 0;
        schedule();
      };
      const onMotion = () => { lastTick = 0; lastRender = 0; schedule(); };
      const onLost = (event: Event) => {
        event.preventDefault(); contextLost = true;
        cancelAnimationFrame(frame); frame = 0;
        container.dataset.state = "unavailable";
      };
      const onRestored = () => {
        contextLost = false; lastTick = 0; lastRender = 0;
        if (model) container.dataset.state = "ready";
        schedule();
      };
      const observer = new ResizeObserver(resize);
      cleanupScene = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        reducedMotion.removeEventListener("change", onMotion);
        renderer.domElement.removeEventListener("webglcontextlost", onLost);
        renderer.domElement.removeEventListener("webglcontextrestored", onRestored);
        if (model) disposeModel(model);
        renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
      };
      document.addEventListener("visibilitychange", onVisibility);
      reducedMotion.addEventListener("change", onMotion);
      renderer.domElement.addEventListener("webglcontextlost", onLost);
      renderer.domElement.addEventListener("webglcontextrestored", onRestored);
      observer.observe(container);
      resize();

      const response = await fetch(MODEL_URL, { signal: controller.signal });
      if (!response.ok) throw new Error("Campus background unavailable");
      const data = await response.arrayBuffer();
      if (disposed) return;
      const gltf = await new GLTFLoader().parseAsync(data, "/models/");
      if (disposed) { disposeModel(gltf.scene); return; }
      model = gltf.scene;
      model.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial) {
            const gray = material.color.r * .299 + material.color.g * .587 + material.color.b * .114;
            material.color.setRGB(gray, gray, gray);
            material.onBeforeCompile = shader => {
              shader.fragmentShader = shader.fragmentShader
                .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = vec3(dot(diffuseColor.rgb, vec3(.299,.587,.114)));")
                .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance = vec3(dot(totalEmissiveRadiance, vec3(.299,.587,.114)));");
            };
            material.customProgramCacheKey = () => "overview-campus-monochrome";
          }
        }
      });
      const bounds = new THREE.Box3().setFromObject(model);
      radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
      if (!Number.isFinite(radius) || radius <= 0) throw new Error("Invalid campus background bounds");
      model.position.sub(bounds.getCenter(new THREE.Vector3()));
      orbit.add(model);
      orbit.rotation.y = Math.PI / 5;
      light.position.set(radius, radius * 3, radius * 2);
      resize();
      container.dataset.state = "ready";
    })().catch(() => {
      if (disposed) return;
      cleanupScene?.(); cleanupScene = undefined;
      container.dataset.state = "unavailable";
    });

    return () => { disposed = true; controller.abort(); cleanupScene?.(); };
  }, []);

  return <div className="overview-backdrop" aria-hidden="true">
    <div className="overview-model-host" ref={host} />
  </div>;
}

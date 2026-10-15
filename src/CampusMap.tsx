import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Activity, LocateFixed, Maximize, RotateCcw, Search } from "lucide-react";
import { roomForLocation } from "./locations";
import "./campus-map.css";

type MapDevice = { device_id: string; location_id: string; handshake: string; last_handshake_at: string | null };
type Props = { selectedPoint: string; onSelectPoint: (id: string) => void; devices: MapDevice[]; onOpenOverview: () => void };
type ViewApi = { focus: (roomId?: string, top?: boolean) => void; select: (roomId: string) => void };
const modelUrl = "/models/mac-campus-ff01.glb";

function disposeObject(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  textures.forEach(texture => { texture.dispose(); if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) texture.image.close(); });
}

export default function CampusMap({ selectedPoint, onSelectPoint, devices, onOpenOverview }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<ViewApi | null>(null);
  const pick = useRef<(roomId: string) => void>(() => {});
  const [room, setRoom] = useState(() => roomForLocation(selectedPoint));
  const selectedRoom = useRef(room);
  selectedRoom.current = room;
  const [rooms, setRooms] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [top, setTop] = useState(false);
  const roomDevices = devices.filter(device => roomForLocation(device.location_id) === room);
  const selectRoom = (id: string) => {
    setRoom(id);
    api.current?.select(id);
    const device = devices.find(item => roomForLocation(item.location_id) === id);
    if (device) onSelectPoint(device.location_id);
  };
  pick.current = selectRoom;
  useEffect(() => { const id = roomForLocation(selectedPoint); if (rooms.includes(id)) { setRoom(id); api.current?.select(id); } }, [selectedPoint, rooms]);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let disposed = false;
    let frame = 0;
    let model: THREE.Object3D | null = null;
    let controls: OrbitControls | null = null;
    let observer: ResizeObserver | null = null;
    const controller = new AbortController();
    let renderer: THREE.WebGLRenderer;
    setState("loading"); setError("");
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" }); }
    catch { setState("error"); setError("此浏览器暂不支持 3D 显示，请启用硬件加速或换用支持 WebGL 的浏览器。"); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0x151515);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-label", "FF-01 三维楼层地图，拖动旋转，滚轮缩放");
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.tabIndex = 0;
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, .1, 3000);
    camera.position.set(125, 145, 150);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x4c4c4c, 1.8));
    const light = new THREE.DirectionalLight(0xffffff, 1.2); light.position.set(60, 130, 80); scene.add(light);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    controls.dampingFactor = .085;
    controls.minDistance = 8; controls.maxDistance = 1200; controls.maxPolarAngle = Math.PI / 2.02;
    controls.listenToKeyEvents(renderer.domElement);
    const resize = () => { const width = container.clientWidth, height = container.clientHeight; if (!width || !height) return; camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height); };
    observer = new ResizeObserver(resize); observer.observe(container); resize();
    const clock = new THREE.Clock();
    let destination: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const animate = () => {
      if (disposed) return;
      const dt = Math.min(clock.getDelta(), .05);
      if (destination) {
        const ease = reduced.matches ? 1 : 1 - Math.exp(-dt * 8);
        camera.position.lerp(destination.position, ease); controls!.target.lerp(destination.target, ease);
        if (camera.position.distanceTo(destination.position) < .025) destination = null;
      }
      controls!.update(); renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    const onControlStart = () => { destination = null; };
    controls.addEventListener("start", onControlStart);
    frame = requestAnimationFrame(animate);
    const roomMeshes = new Map<string, THREE.Mesh>();
    const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const highlight = new THREE.MeshBasicMaterial({ color: 0x6dcaff, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    let bounds: THREE.Box3 | null = null;
    const focus = (id?: string, topView = false) => {
      if (!bounds) return;
      const targetBounds = id && roomMeshes.has(id) ? new THREE.Box3().setFromObject(roomMeshes.get(id)!) : bounds;
      const target = targetBounds.getCenter(new THREE.Vector3());
      const offset = topView ? new THREE.Vector3(0, 1, .001) : new THREE.Vector3(.55, .95, .9).normalize();
      const right = new THREE.Vector3().crossVectors(camera.up, offset).normalize();
      const up = new THREE.Vector3().crossVectors(offset, right).normalize();
      const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      let distance = 12;
      // Fit every bounding-box corner, accounting for perspective and aspect ratio.
      for (const x of [targetBounds.min.x, targetBounds.max.x]) for (const y of [targetBounds.min.y, targetBounds.max.y]) for (const z of [targetBounds.min.z, targetBounds.max.z]) {
        const corner = new THREE.Vector3(x, y, z).sub(target);
        distance = Math.max(distance, corner.dot(offset) + Math.max(Math.abs(corner.dot(right)) / (tangent * camera.aspect), Math.abs(corner.dot(up)) / tangent));
      }
      distance *= id ? 1.55 : 1.17;
      destination = { target, position: target.clone().addScaledVector(offset, distance) };
    };
    api.current = { focus, select: id => { for (const [key, mesh] of roomMeshes) mesh.material = key === id ? highlight : originalMaterials.get(mesh)!; } };
    let down: { x: number; y: number } | null = null;
    const onDown = (event: PointerEvent) => { down = event.button === 0 ? { x: event.clientX, y: event.clientY } : null; };
    const onUp = (event: PointerEvent) => {
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) { down = null; return; }
      down = null;
      const rect = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
      const hit = ray.intersectObjects(Array.from(roomMeshes.values()), false)[0];
      if (hit?.object.userData.roomId) pick.current(hit.object.userData.roomId);
    };
    const onLost = (event: Event) => { event.preventDefault(); if (!disposed) { setState("error"); setError("3D 显示连接中断，可以重新加载模型。"); } };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("webglcontextlost", onLost);
    void (async () => {
      try {
        const response = await fetch(modelUrl, { signal: controller.signal });
        if (!response.ok) throw new Error("模型文件读取失败");
        const data = await response.arrayBuffer();
        if (disposed) return;
        const gltf = await new GLTFLoader().parseAsync(data, "/models/");
        if (disposed) { disposeObject(gltf.scene); return; }
        model = gltf.scene;
        model.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          originalMaterials.set(object, object.material);
          const id = object.userData.roomId;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial) {
              const brightness = material.color.r * .299 + material.color.g * .587 + material.color.b * .114;
              material.color.setRGB(brightness, brightness, brightness);
              if (id) material.color.setHex(0x454545);
              // Keep source label textures and vertex colors readable in monochrome.
              material.onBeforeCompile = shader => {
                shader.fragmentShader = shader.fragmentShader
                  .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = vec3(dot(diffuseColor.rgb, vec3(.299,.587,.114)));")
                  .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance = vec3(dot(totalEmissiveRadiance, vec3(.299,.587,.114)));");
              };
              material.customProgramCacheKey = () => "campus-monochrome";
            }
          }
          if (typeof id === "string") roomMeshes.set(id, object);
        });
        scene.add(model);
        bounds = new THREE.Box3().setFromObject(model);
        const ids = Array.from(roomMeshes.keys()).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
        setRooms(ids); api.current?.select(selectedRoom.current);
        focus();
        setState("ready");
      } catch (cause) { if (!disposed) { setState("error"); setError(cause instanceof Error ? cause.message : "模型加载失败，请重试。"); } }
    })();
    return () => {
      disposed = true; controller.abort(); cancelAnimationFrame(frame); api.current = null;
      observer?.disconnect(); controls?.dispose();
      renderer.domElement.removeEventListener("pointerdown", onDown); renderer.domElement.removeEventListener("pointerup", onUp); renderer.domElement.removeEventListener("webglcontextlost", onLost);
      // Restore shared materials so disposal includes every original room material.
      originalMaterials.forEach((material, mesh) => { mesh.material = material; });
      if (model) disposeObject(model);
      highlight.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, [retry]);

  const matches = rooms.filter(id => id.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="glass-panel campus-3d-workspace">
    <div className="section-heading"><div><div className="section-kicker">SPATIAL ATLAS / FF-01</div><h2>校园三维地图</h2></div><span className="record-badge">{rooms.length || "—"} 个房间 · 当前设备 M104</span></div>
    <p className="workspace-intro">使用你提供的 FF-01 模型。拖动旋转、滚轮缩放、右键平移；点击房间查看详情。房间边界来自模型，实际安装位置由你确认。</p>
    <div className="campus-3d-layout">
      <div className="campus-3d-stage">
        <div className="campus-model-host" ref={host} />
        <div className="campus-model-caption"><span>FF—01 / FLOOR MODEL</span><strong>{room}</strong><span>SELECTED ROOM</span></div>
        <div className="campus-model-controls" aria-label="地图视角控制">
          <button type="button" disabled={state !== "ready"} onClick={() => { setTop(false); api.current?.focus(); }} title="查看全图"><Maximize size={15} />全图</button>
          <button type="button" disabled={state !== "ready"} onClick={() => { setTop(value => !value); api.current?.focus(undefined, !top); }}><RotateCcw size={15} />{top ? "立体" : "俯视"}</button>
          <button type="button" disabled={state !== "ready"} onClick={() => api.current?.focus(room, top)}><LocateFixed size={15} />聚焦 {room}</button>
        </div>
        {state !== "ready" ? <div className="campus-model-overlay" role="status"><strong>{state === "loading" ? "正在载入三维地图…" : "暂时无法显示地图"}</strong><span>{state === "loading" ? "首次加载约 5.9 MB" : error}</span>{state === "error" ? <button type="button" onClick={() => setRetry(count => count + 1)}>重新加载</button> : null}</div> : null}
      </div>
      <aside className="campus-room-panel">
        <div className="section-kicker">FIND A ROOM</div>
        <label className="campus-room-search"><Search size={16} /><input aria-label="搜索房间编号" placeholder="搜索房间，例如 M104" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && matches.length) { selectRoom(matches[0]); api.current?.focus(matches[0], top); } }} /></label>
        <div className="campus-room-list" aria-label="房间列表">{matches.map(id => <button type="button" key={id} aria-pressed={room === id} onClick={() => { selectRoom(id); api.current?.focus(id, top); }}>{id}{id === "M104" ? <span>当前设备</span> : null}</button>)}{state === "ready" && !matches.length ? <p>没有匹配的房间</p> : null}</div>
        <div className="campus-room-detail"><div className="section-kicker">SELECTED ROOM</div><h3>{room}</h3>
          {room === "M104" ? <p>当前环境采集设备安装在此教室。历史数据沿用点位编号 M1。</p> : <p>模型中的房间编号；尚未确认此处安装了环境采集设备。</p>}
          {roomDevices.map(device => <div className="campus-room-device" key={device.device_id}><strong>{device.device_id}</strong><span>{device.handshake === "online" ? "握手在线" : device.handshake === "expired" ? "握手已超时" : "握手状态待确认"}</span></div>)}
          {room === "M104" && !roomDevices.length ? <p className="campus-model-note">设备状态尚未返回，可先查看该点位历史数据。</p> : null}
          {room === "M104" || roomDevices.length ? <button type="button" className="primary-action" onClick={() => { onSelectPoint(roomDevices[0]?.location_id ?? "M1"); onOpenOverview(); }}>查看环境数据 <Activity size={14} /></button> : null}
        </div>
        <p className="campus-model-note">模型可用于点位浏览。户外样方位置尚未确认，未添加推测标记。</p>
      </aside>
    </div>
  </section>;
}

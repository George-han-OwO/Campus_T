import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ChevronLeft, ChevronRight } from "lucide-react";
import roomShapes from "./roomShapes.json";

type RoomShape = {
  id: string;
  name: string;
  kindLabel: string;
  areaM2Region: number | null;
  polygon: { outer: number[][]; holes: number[][][] };
};

const rooms = roomShapes as RoomShape[];
const roomById = new Map(rooms.map(room => [room.id, room]));
const slotX = [-17, -9, 0, 9, 17];
const slotScale = [0.3, 0.49, 0.86, 0.49, 0.3];

function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) geometries.add(object.geometry);
    const material = (object as THREE.Mesh | THREE.Line).material;
    for (const item of Array.isArray(material) ? material : material ? [material] : []) materials.add(item);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}

function setEmphasis(root: THREE.Group, amount: number) {
  root.traverse(object => {
    const material = (object as THREE.Mesh | THREE.Line).material;
    for (const item of Array.isArray(material) ? material : material ? [material] : []) {
      item.transparent = true;
      item.opacity = amount * (item instanceof THREE.LineBasicMaterial ? 0.82 : 0.34);
    }
  });
}

function buildRoom(room: RoomShape) {
  const group = new THREE.Group();
  group.name = `separated-room-${room.id}`;
  const outer = room.polygon.outer;
  const allRings = [outer, ...room.polygon.holes];
  const xs = outer.map(point => point[0]);
  const zs = outer.map(point => point[1]);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerZ = (Math.min(...zs) + Math.max(...zs)) / 2;
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanZ = Math.max(...zs) - Math.min(...zs);
  const height = 2.8;
  // Keep the illustrative wall height in scale even for narrow service rooms.
  const scale = 10 / Math.max(spanX, spanZ, height * 1.35, 1);

  const contour = outer.map(([x, z]) => new THREE.Vector2(x, -z));
  const holes = room.polygon.holes.map(ring => ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  const triangles = THREE.ShapeUtils.triangulateShape(contour, holes);
  const flat = [...contour, ...holes.flat()];
  const floorGeometry = new THREE.BufferGeometry();
  floorGeometry.setAttribute("position", new THREE.Float32BufferAttribute(flat.flatMap(point => [point.x - centerX, 0, -point.y - centerZ]), 3));
  floorGeometry.setIndex(triangles.flat());
  floorGeometry.computeVertexNormals();
  const floor = new THREE.Mesh(floorGeometry, new THREE.MeshBasicMaterial({ color: 0xa9a9a9, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
  floor.position.y = 0.015;
  floor.renderOrder = 1;
  group.add(floor);

  const wallPositions: number[] = [];
  const edgePositions: number[] = [];
  for (const ring of allRings) {
    for (let index = 0; index < ring.length; index += 1) {
      const [rawX0, rawZ0] = ring[index];
      const [rawX1, rawZ1] = ring[(index + 1) % ring.length];
      const x0 = rawX0 - centerX, z0 = rawZ0 - centerZ;
      const x1 = rawX1 - centerX, z1 = rawZ1 - centerZ;
      wallPositions.push(x0, 0, z0, x1, 0, z1, x1, height, z1, x0, 0, z0, x1, height, z1, x0, height, z0);
      edgePositions.push(x0, 0.025, z0, x1, 0.025, z1, x0, height, z0, x1, height, z1, x0, 0.025, z0, x0, height, z0);
    }
  }
  const wallGeometry = new THREE.BufferGeometry();
  wallGeometry.setAttribute("position", new THREE.Float32BufferAttribute(wallPositions, 3));
  wallGeometry.computeVertexNormals();
  const walls = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({ color: 0xd6d6d6, roughness: 0.32, metalness: 0.16, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  walls.renderOrder = 2;
  group.add(walls);

  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));
  const edges = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: 0xf4f4f4, transparent: true, opacity: 0.78 }));
  edges.renderOrder = 3;
  group.add(edges);
  group.scale.setScalar(scale);
  return group;
}

function spring(value: number, velocity: number, target: number, dt: number) {
  const acceleration = (target - value) * 68 - velocity * 17;
  const nextVelocity = velocity + acceleration * dt;
  return { value: value + nextVelocity * dt, velocity: nextVelocity };
}

type CardMotion = {
  group: THREE.Group;
  id: string;
  slot: number;
  targetX: number;
  targetZ: number;
  targetY: number;
  targetScale: number;
  targetRotation: number;
  vx: number;
  vy: number;
  vz: number;
  vs: number;
  vr: number;
  outgoing?: boolean;
  elapsed?: number;
};

export default function RoomModelViewer({ roomId, onSelectRoom }: { roomId: string; onSelectRoom: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const roomIdRef = useRef(roomId);
  const selectRoomRef = useRef(onSelectRoom);
  const activeRoomRef = useRef<string | null>(null);
  roomIdRef.current = roomId;
  selectRoomRef.current = onSelectRoom;
  const switchRoomRef = useRef<(id: string, immediate?: boolean) => void>(() => {});
  const stepRef = useRef<(offset: number) => void>(() => {});
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [roomLabel, setRoomLabel] = useState(() => roomById.get(roomId)?.name ?? roomId);
  const [roomKind, setRoomKind] = useState(() => roomById.get(roomId)?.kindLabel ?? "空间");
  const [roomIndex, setRoomIndex] = useState(() => Math.max(0, rooms.findIndex(room => room.id === roomId)));
  const [reducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let disposed = false;
    let frame = 0;
    let lastTime = 0;
    let controls: OrbitControls | null = null;
    let observer: ResizeObserver | null = null;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
    } catch {
      setState("error");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x101010);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-label", "独立教室三维模型轮播，可拖动观察并用左右按钮切换教室");
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 180);
    camera.position.set(0, 12, 34);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x383838, 2.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
    keyLight.position.set(7, 14, 9);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0xffffff, 1.7);
    rimLight.position.set(-10, 7, -9);
    scene.add(rimLight);
    const floorGrid = new THREE.GridHelper(58, 58, 0x343434, 0x202020);
    floorGrid.position.y = -0.045;
    scene.add(floorGrid);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !reducedMotion;
    controls.dampingFactor = 0.075;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.minPolarAngle = Math.PI * 0.23;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.target.set(0, 1.0, 0);
    controls.update();

    let cards: CardMotion[] = [];
    const addRoom = (id: string, immediate = false) => {
      const room = roomById.get(id) ?? roomById.get("M104") ?? rooms[0];
      if (!room) return;
      if (activeRoomRef.current === room.id && cards.some(card => !card.outgoing && card.slot === 0)) return;
      const centerCard = cards.find(card => !card.outgoing && card.slot === 0);
      if (centerCard && !immediate && !reducedMotion) {
        centerCard.outgoing = true;
        centerCard.elapsed = 0;
        centerCard.vy = 0;
        centerCard.vx = (Math.random() - 0.5) * 1.4;
      }
      cards = cards.filter(card => {
        if (card === centerCard && !immediate && !reducedMotion) return true;
        scene.remove(card.group);
        disposeObject(card.group);
        return false;
      });

      const index = Math.max(0, rooms.findIndex(item => item.id === room.id));
      setRoomIndex(index);
      setRoomLabel(room.name);
      setRoomKind(room.kindLabel);
      activeRoomRef.current = room.id;
      // Treat the selected classroom as a single hero object, like the supplied
      // product-scroller reference. Room changes animate the outgoing shell away
      // and let the next shell settle into the same focal position.
      for (const relative of [0]) {
        const slot = 2;
        const item = room;
        const group = buildRoom(item);
        const baseScale = group.scale.x;
        const targetScale = baseScale * slotScale[slot];
        const targetRotation = relative === 0 ? 0 : relative < 0 ? 0.2 : -0.2;
        const motion: CardMotion = {
          group,
          id: item.id,
          slot,
          targetX: slotX[slot],
          targetZ: slot === 2 ? 0 : -Math.abs(relative) * 1.3,
          targetY: slot === 2 ? 0 : 0.15 + Math.abs(relative) * 0.3,
          targetScale: targetScale * 1.15,
          targetRotation,
          vx: 0, vy: 0, vz: 0, vs: 0, vr: 0,
        };
        group.position.set(motion.targetX, immediate || reducedMotion ? motion.targetY : motion.targetY + (slot === 2 ? 4.5 : 0.8), motion.targetZ);
        group.rotation.y = targetRotation;
        group.scale.setScalar(immediate || reducedMotion ? targetScale : targetScale * (slot === 2 ? 0.8 : 0.92));
        setEmphasis(group, slot === 2 ? 1 : slot === 1 || slot === 3 ? 0.68 : 0.42);
        scene.add(group);
        cards.push(motion);
      }
      setState("ready");
    };
    switchRoomRef.current = (id, immediate) => addRoom(id, immediate);
    stepRef.current = offset => {
      const index = Math.max(0, rooms.findIndex(room => room.id === activeRoomRef.current));
      const next = (index + offset + rooms.length) % rooms.length;
      const id = rooms[next]?.id;
      if (id) selectRoomRef.current(id);
    };

    let wheelDelta = 0;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      wheelDelta += event.deltaY;
      if (Math.abs(wheelDelta) > 85) {
        stepRef.current(wheelDelta > 0 ? 1 : -1);
        wheelDelta = 0;
      }
    };
    container.addEventListener("wheel", onWheel, { passive: false });

    const resize = () => {
      const width = container.clientWidth, height = container.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    addRoom(roomIdRef.current, true);
    const animate = (time: number) => {
      if (disposed) return;
      const dt = Math.min(lastTime ? (time - lastTime) / 1000 : 0, 0.04);
      lastTime = time;
      cards.forEach(motion => {
        if (motion.outgoing) {
          motion.elapsed = (motion.elapsed ?? 0) + dt;
          motion.vy += 20 * dt;
          motion.group.position.y -= motion.vy * dt;
          motion.group.position.x += motion.vx * dt;
          motion.group.scale.multiplyScalar(Math.exp(-1.1 * dt));
          if ((motion.elapsed ?? 0) > 1.15) {
            scene.remove(motion.group); disposeObject(motion.group);
            cards.splice(cards.indexOf(motion), 1);
          }
          return;
        }
        const x = spring(motion.group.position.x, motion.vx, motion.targetX, dt);
        motion.vx = x.velocity; motion.group.position.x = x.value;
        const y = spring(motion.group.position.y, motion.vy, motion.targetY, dt);
        motion.vy = y.velocity; motion.group.position.y = y.value;
        const z = spring(motion.group.position.z, motion.vz, motion.targetZ, dt);
        motion.vz = z.velocity; motion.group.position.z = z.value;
        const scale = spring(motion.group.scale.x, motion.vs, motion.targetScale, dt);
        motion.vs = scale.velocity; motion.group.scale.setScalar(scale.value);
        if (motion.slot === 2 && !reducedMotion) motion.group.rotation.y += dt * 0.12;
        else {
          const rotation = spring(motion.group.rotation.y, motion.vr, motion.targetRotation, dt);
          motion.vr = rotation.velocity; motion.group.rotation.y = rotation.value;
        }
      });
      controls?.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      container.removeEventListener("wheel", onWheel);
      controls?.dispose();
      cards.forEach(card => disposeObject(card.group));
      disposeObject(floorGrid);
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
      switchRoomRef.current = () => {};
      stepRef.current = () => {};
    };
  }, [reducedMotion]);

  useEffect(() => { switchRoomRef.current(roomId); }, [roomId]);

  return <div className="isolated-room-view" data-state={state}>
    <div className="isolated-room-canvas" ref={host} />
    <div className="room-carousel-heading"><span>ROOM SELECTION / FF—01</span><strong>{String(roomIndex + 1).padStart(3, "0")} <i>/ {rooms.length}</i></strong></div>
    <div className="isolated-room-label" aria-live="polite"><span>{roomKind.toUpperCase()} / SELECTED SPACE</span><strong>{roomId}</strong><em>{roomLabel}</em><small>独立空间模型 · 滚轮或箭头切换 · 拖动观察</small></div>
    <button className="room-carousel-arrow room-carousel-arrow--previous" type="button" aria-label="上一个教室" onClick={() => stepRef.current(-1)}><ChevronLeft size={28} /></button>
    <button className="room-carousel-arrow room-carousel-arrow--next" type="button" aria-label="下一个教室" onClick={() => stepRef.current(1)}><ChevronRight size={28} /></button>
    <div className="room-carousel-neighbors" aria-hidden="true"><span>{rooms[(roomIndex - 1 + rooms.length) % rooms.length]?.id}</span><span>{rooms[(roomIndex + 1) % rooms.length]?.id}</span></div>
    {state === "error" ? <div className="isolated-room-error">浏览器暂不支持 3D 显示，请启用硬件加速。</div> : null}
  </div>;
}

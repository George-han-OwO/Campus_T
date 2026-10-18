import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { ArrowDown, ArrowUpRight, ChevronLeft, ChevronRight, Search } from "lucide-react";
import roomShapes from "./roomShapes.json";

type RoomShape = {
  id: string;
  name: string;
  kindLabel: string;
  areaM2Region: number | null;
  polygon: { outer: number[][]; holes: number[][][] };
};

export const roomCatalog = roomShapes as RoomShape[];
const rooms = roomCatalog;
const roomById = new Map(rooms.map(room => [room.id, room]));

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
      if (item.userData.baseOpacity === undefined) item.userData.baseOpacity = item.opacity;
      item.transparent = true;
      item.opacity = amount * Number(item.userData.baseOpacity);
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
  const floor = new THREE.Mesh(floorGeometry, new THREE.MeshStandardMaterial({ color: 0x656565, roughness: .36, metalness: .16, transparent: true, opacity: .92, side: THREE.DoubleSide }));
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
      edgePositions.push(x0, 0.025, z0, x1, 0.025, z1, x0, height, z0, x1, height, z1);
      // Curved door outlines contain many tiny segments. Keep their continuous
      // top and bottom edges, but draw vertical seams only at genuine corners.
      const previous = ring[(index - 1 + ring.length) % ring.length];
      const incoming = new THREE.Vector2(rawX0 - previous[0], rawZ0 - previous[1]).normalize();
      const outgoing = new THREE.Vector2(rawX1 - rawX0, rawZ1 - rawZ0).normalize();
      if (incoming.dot(outgoing) < .86) edgePositions.push(x0, .025, z0, x0, height, z0);
    }
  }
  const wallGeometry = new THREE.BufferGeometry();
  wallGeometry.setAttribute("position", new THREE.Float32BufferAttribute(wallPositions, 3));
  wallGeometry.computeVertexNormals();
  const walls = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({ color: 0xd6d6d6, roughness: .3, metalness: .18, transparent: true, opacity: .52, side: THREE.DoubleSide, depthWrite: false }));
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

type Props = {
  roomId: string;
  onSelectRoom: (id: string) => void;
  onChooseRoom: () => void;
  onOpenData: () => void;
  deviceCount: number;
  handshakeLabel: string;
  canOpenData: boolean;
};
type ModelEntry = { holder: THREE.Group; arrival: number; target: number; velocity: number; leaving: boolean; age: number };

const chapters = ["空间开场", "教室轮廓", "现场观测"];
const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;

export default function RoomModelViewer({ roomId, onSelectRoom, onChooseRoom, onOpenData, deviceCount, handshakeLabel, canOpenData }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const copies = useRef<(HTMLDivElement | null)[]>([]);
  const ghost = useRef<HTMLDivElement>(null);
  const meter = useRef<HTMLSpanElement>(null);
  const requestedRoom = useRef(roomId);
  const switchDirection = useRef(0);
  const switchRoom = useRef<(id: string, initial?: boolean) => void>(() => {});
  const jumpTo = useRef<(chapter: number) => void>(() => {});
  const [chapter, setChapter] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  requestedRoom.current = roomId;
  const room = roomById.get(roomId) ?? rooms[0];
  const roomIndex = Math.max(0, rooms.findIndex(item => item.id === roomId));
  const stepRoom = (offset: number) => {
    switchDirection.current = Math.sign(offset);
    onSelectRoom(rooms[(roomIndex + offset + rooms.length) % rooms.length].id);
  };

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const container = host.current, stage = viewport.current, section = track.current;
    if (!container || !stage || !section) return;
    let renderer: THREE.WebGLRenderer;
    setState("loading");
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" }); }
    catch { setState("error"); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    renderer.domElement.setAttribute("aria-label", "跟随页面滚动转动和移动的独立教室三维模型，鼠标拖动可调整角度");
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.style.touchAction = "pan-y";
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 150);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3c3c3c, 2.5));
    const key = new THREE.DirectionalLight(0xffffff, 3.5);
    key.position.set(6, 12, 8);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 2.5);
    rim.position.set(-9, 5, -7);
    scene.add(rim);
    const rig = new THREE.Group();
    scene.add(rig);

    let entries: ModelEntry[] = [];
    let activeId = "";
    const replaceRoom = (id: string, initial = false) => {
      if (id === activeId) return;
      const next = roomById.get(id) ?? roomById.get("M104") ?? rooms[0];
      if (!next) return;
      const previousIndex = rooms.findIndex(item => item.id === activeId);
      const nextIndex = rooms.findIndex(item => item.id === next.id);
      const forward = (nextIndex - previousIndex + rooms.length) % rooms.length;
      const direction = switchDirection.current || (forward <= rooms.length / 2 ? 1 : -1);
      switchDirection.current = 0;
      // Bound resources during rapid clicks and keep the current model's velocity.
      entries = entries.filter(entry => {
        if (!entry.leaving) return true;
        rig.remove(entry.holder); disposeObject(entry.holder); return false;
      });
      entries.forEach(entry => { entry.leaving = true; entry.target = -direction * 19; entry.age = 0; });
      const model = buildRoom(next);
      model.position.sub(new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()));
      const holder = new THREE.Group();
      holder.add(model);
      rig.add(holder);
      const entry = { holder, arrival: initial || reducedMotion ? 0 : direction * 19, target: 0, velocity: 0, leaving: false, age: 0 };
      entries.push(entry);
      activeId = next.id;
      setState("ready");
    };
    switchRoom.current = replaceRoom;
    replaceRoom(requestedRoom.current, true);

    let targetProgress = 0, progress = 0, initialized = false, previousChapter = -1;
    let width = 1, height = 1, compact = false, visible = true;
    let frame = 0, lastTime = 0, elapsed = 0;
    let pointerX = 0, pointerY = 0, dragYaw = 0;
    let drag: { id: number; x: number } | null = null;
    const updateScroll = () => {
      const rect = section.getBoundingClientRect();
      const top = parseFloat(getComputedStyle(stage).top) || 0;
      const distance = Math.max(1, section.offsetHeight - stage.offsetHeight);
      targetProgress = clamp((top - rect.top) / distance, 0, 1);
      if (!initialized) { progress = targetProgress; initialized = true; }
    };
    const resize = () => {
      width = container.clientWidth; height = container.clientHeight;
      if (!width || !height) return;
      compact = width < 700;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const distance = Math.max(23, 11.5 / (2 * Math.tan(THREE.MathUtils.degToRad(17)) * camera.aspect));
      camera.position.set(0, distance * .61, distance * .8);
      camera.lookAt(0, 0, 0);
      renderer.setSize(width, height);
      updateScroll();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();
    const visibility = new IntersectionObserver(items => { visible = items[0].isIntersecting; });
    visibility.observe(section);
    window.addEventListener("scroll", updateScroll, { passive: true });
    window.addEventListener("resize", updateScroll);
    jumpTo.current = index => {
      const top = parseFloat(getComputedStyle(stage).top) || 0;
      const distance = Math.max(1, section.offsetHeight - stage.offsetHeight);
      window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top - top + distance * index / 2, behavior: reducedMotion ? "instant" : "smooth" });
    };
    const pointerMove = (event: PointerEvent) => {
      const rect = stage.getBoundingClientRect();
      pointerX = clamp((event.clientX - rect.left) / rect.width - .5, -.5, .5);
      pointerY = clamp((event.clientY - rect.top) / rect.height - .5, -.5, .5);
      if (drag?.id === event.pointerId) { dragYaw += (event.clientX - drag.x) * .009; drag.x = event.clientX; }
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX };
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const pointerUp = (event: PointerEvent) => { if (drag?.id === event.pointerId) drag = null; };
    const pointerLeave = () => { if (!drag) { pointerX = 0; pointerY = 0; } };
    const contextLost = (event: Event) => { event.preventDefault(); setState("error"); };
    stage.addEventListener("pointermove", pointerMove);
    stage.addEventListener("pointerleave", pointerLeave);
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.domElement.addEventListener("pointercancel", pointerUp);
    renderer.domElement.addEventListener("webglcontextlost", contextLost);

    const inverseRigRotation = new THREE.Quaternion();
    const animate = (time: number) => {
      const dt = Math.min(lastTime ? (time - lastTime) / 1000 : .016, .04);
      lastTime = time;
      frame = requestAnimationFrame(animate);
      if (document.hidden || !visible) return;
      elapsed += dt;
      const ease = reducedMotion ? 1 : 1 - Math.exp(-dt * 7);
      progress = mix(progress, targetProgress, ease);
      const nextChapter = Math.min(2, Math.round(progress * 2));
      if (previousChapter !== nextChapter) { previousChapter = nextChapter; setChapter(nextChapter); }
      const phase = Math.min(1.9999, progress * 2), index = Math.floor(phase), t = phase - index;
      const eased = t * t * (3 - 2 * t);
      const xPoses = compact ? [0, 0, 0] : [2.3, 4.1, -3.8];
      const yawPoses = [-.55, .95, 3.55];
      const tiltPoses = [.08, -.12, .08];
      const scalePoses = compact ? (height < 460 ? [.65, .61, .58] : [.8, .75, .72]) : [1.08, 1.03, .94];
      const x = mix(xPoses[index], xPoses[index + 1], eased);
      const yaw = mix(yawPoses[index], yawPoses[index + 1], eased);
      const tilt = mix(tiltPoses[index], tiltPoses[index + 1], eased);
      const scale = mix(scalePoses[index], scalePoses[index + 1], eased);
      const breathe = reducedMotion ? 0 : Math.sin(elapsed * .8) * .11;
      rig.position.set(x, (compact ? height < 460 ? 4.2 : 3.2 : .35) + breathe, 0);
      rig.rotation.set(tilt + (reducedMotion ? 0 : pointerY * .12), (reducedMotion ? -.55 : yaw + elapsed * .035 + pointerX * .16) + dragYaw, reducedMotion ? 0 : Math.sin(progress * Math.PI * 2) * .065);
      rig.scale.setScalar(reducedMotion ? .94 : scale);
      inverseRigRotation.copy(rig.quaternion).invert();
      entries = entries.filter(entry => {
        entry.age += dt;
        entry.velocity += ((entry.target - entry.arrival) * 58 - entry.velocity * 15) * dt;
        entry.arrival += entry.velocity * dt;
        if (reducedMotion) entry.arrival = entry.target;
        // Cancel the presentation rotation for the slide offset: left/right stays
        // horizontal on screen at every chapter and at every dragged model angle.
        entry.holder.position.set(entry.arrival / rig.scale.x, 0, 0).applyQuaternion(inverseRigRotation);
        if (entry.leaving) {
          setEmphasis(entry.holder, Math.max(0, 1 - entry.age / .65));
          if (reducedMotion || entry.age > .85) { rig.remove(entry.holder); disposeObject(entry.holder); return false; }
        }
        return true;
      });
      copies.current.forEach((copy, copyIndex) => {
        if (!copy) return;
        const delta = progress - copyIndex / 2;
        const opacity = clamp(1 - Math.abs(delta) * 3.3, 0, 1);
        copy.style.opacity = String(opacity);
        copy.style.transform = reducedMotion ? "none" : `translateY(${-delta * 70}px)`;
        copy.style.pointerEvents = opacity > .65 ? "auto" : "none";
        copy.style.visibility = opacity < .01 ? "hidden" : "visible";
      });
      if (ghost.current) ghost.current.style.transform = `translateX(${5 - progress * 24}%)`;
      if (meter.current) meter.current.style.transform = `scaleX(${progress})`;
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); visibility.disconnect();
      window.removeEventListener("scroll", updateScroll); window.removeEventListener("resize", updateScroll);
      stage.removeEventListener("pointermove", pointerMove); stage.removeEventListener("pointerleave", pointerLeave);
      renderer.domElement.removeEventListener("pointerdown", pointerDown); renderer.domElement.removeEventListener("pointerup", pointerUp); renderer.domElement.removeEventListener("pointercancel", pointerUp);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      entries.forEach(entry => disposeObject(entry.holder));
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
      switchRoom.current = () => {}; jumpTo.current = () => {};
    };
  }, [reducedMotion, retry]);

  useEffect(() => { switchRoom.current(roomId); }, [roomId]);

  return <div className="room-journey" ref={track} data-chapter={chapter} data-state={state}>
    <div className="room-journey-viewport" ref={viewport}>
      <div className="room-journey-ghost" ref={ghost} aria-hidden="true">{roomId}</div>
      <div className="room-journey-canvas" ref={host} />
      <div className="room-journey-coordinate"><span>FF—01 / SPATIAL ATLAS</span><span>{String(roomIndex + 1).padStart(3, "0")} — {rooms.length} SPACES</span></div>
      <div className="room-story-copy room-story-copy--hero" ref={element => { copies.current[0] = element; }} aria-hidden={chapter !== 0}>
        <span className="room-story-eyebrow">01 / EXPLORE THE CAMPUS</span>
        <h1>校园，<br />逐间展开。</h1>
        <p>从空间的轮廓出发，<br />找到每一次观测发生的地方。</p>
        <div className="room-story-room"><strong>{roomId}</strong><span>{room?.name}</span></div>
      </div>
      <div className="room-story-copy room-story-copy--shape" ref={element => { copies.current[1] = element; }} aria-hidden={chapter !== 1}>
        <span className="room-story-eyebrow">02 / THE SHAPE OF A ROOM</span>
        <h2>走近，<br />这处空间。</h2>
        <p>{room?.name} · {room?.kindLabel}<br />独立展开房间边界，换一个角度看校园。</p>
        <div className="room-story-facts">
          <div><strong>{room?.areaM2Region?.toFixed(1) ?? "—"}<small> m²</small></strong><span>图纸轮廓面积</span></div>
          <div><strong>2.8<small> m</small></strong><span>示意墙高</span></div>
        </div>
        <small className="room-story-note">依据 FF-01 图纸生成，尺寸尚未经现场测量核验。</small>
      </div>
      <div className="room-story-copy room-story-copy--data" ref={element => { copies.current[2] = element; }} aria-hidden={chapter !== 2}>
        <span className="room-story-eyebrow">03 / CONNECTED TO THE FIELD</span>
        <h2>让观测，<br />回到现场。</h2>
        <p>{canOpenData ? `在 ${roomId}，连接空间与环境记录。` : `${roomId} 尚未确认安装采集设备。`}<br />每条记录，都应该有对应的位置。</p>
        <div className="room-story-device"><span>{deviceCount ? `${deviceCount} 台设备` : "设备状态"}</span><strong>{handshakeLabel}</strong></div>
        {canOpenData ? <button type="button" className="room-story-action" onClick={onOpenData}>查看环境数据 <ArrowUpRight size={18} /></button> : <button type="button" className="room-story-action" onClick={() => onSelectRoom("M104")}>前往设备教室 M104 <ArrowUpRight size={18} /></button>}
        <small className="room-story-note">设备安装位置：M104 · 历史数据点位：M1</small>
      </div>
      <nav className="room-story-chapters" aria-label="展示章节">
        {chapters.map((label, index) => <button type="button" key={label} aria-label={label} aria-current={chapter === index ? "step" : undefined} onClick={() => jumpTo.current(index)}><span>{String(index + 1).padStart(2, "0")}</span><i /></button>)}
      </nav>
      <button className="room-side-arrow room-side-arrow--previous" type="button" aria-label="上一个教室" title="上一个教室" onClick={() => stepRoom(-1)}><ChevronLeft size={30} /></button>
      <button className="room-side-arrow room-side-arrow--next" type="button" aria-label="下一个教室" title="下一个教室" onClick={() => stepRoom(1)}><ChevronRight size={30} /></button>
      <div className="room-journey-bottom">
        <div className="room-switcher" aria-label="切换教室">
          <button type="button" className="room-switcher-current" onClick={onChooseRoom}><span>{roomId}</span><small>切换空间</small><Search size={14} /></button>
        </div>
        <button className="room-scroll-cue" type="button" onClick={() => jumpTo.current(chapter === 2 ? 0 : chapter + 1)}><span>{chapter === 2 ? "返回开场" : "向下滚动探索"}</span><ArrowDown size={15} /></button>
      </div>
      <div className="room-journey-progress" aria-hidden="true"><span ref={meter} /></div>
      {state === "error" ? <div className="room-journey-error" role="status"><strong>3D 场景暂时不可用</strong><p>你仍可以搜索房间、查看位置与设备信息。</p><button type="button" onClick={() => setRetry(value => value + 1)}>重新加载 3D</button></div> : null}
    </div>
  </div>;
}

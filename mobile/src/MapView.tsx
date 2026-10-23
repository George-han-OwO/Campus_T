import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Compass, Layers2, LocateFixed, Minus, Plus } from "lucide-react";
import { bounds, center, rooms, type Point } from "./navigation";
import {
  fitMapPoints,
  mapPoint,
  mapScale,
  transformView,
  MIN_MAP_SPAN,
  MAX_MAP_SPAN,
  type MapInsets,
  type MapViewState,
} from "./mapViewport";
import "./MapView.css";

type Props = {
  selected: string | null;
  start: string;
  route: Point[];
  current?: Point;
  editing: boolean;
  onSelect: (id: string) => void;
  onPoint: (point: Point) => void;
  labels: boolean;
  filter: string;
  fitVersion: number;
};

const features = rooms.map((room) => ({
  ...room,
  middle: center(room),
  path: [room.polygon.outer, ...room.polygon.holes]
    .map(
      (ring) =>
        ring
          .map((point, index) => `${index ? "L" : "M"}${point[0]},${point[1]}`)
          .join(" ") + "Z",
    )
    .join(" "),
}));
const campusCorners: Point[] = [
  [bounds.x, bounds.y],
  [bounds.x + bounds.width, bounds.y + bounds.height],
];
const matches = (kind: string, filter: string) =>
  filter === "全部" ||
  kind ===
    (
      {
        教室: "教室与书院",
        阅读: "图书与阅读",
        餐饮: "餐厅",
        餐厅: "餐厅",
      } as Record<string, string>
    )[filter] ||
  kind === filter;

export default function MapView({
  selected,
  start,
  route,
  current,
  editing,
  onSelect,
  onPoint,
  labels,
  filter,
  fitVersion,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const roomElements = useRef(new Map<string, SVGGElement>());
  const [size, setSize] = useState({ width: 400, height: 800 });
  const [view, setView] = useState<MapViewState>({ x: 0, y: 3, span: 146 });
  const [focused, setFocused] = useState(selected ?? start);
  const [dragging, setDragging] = useState(false);
  const [insets, setInsets] = useState<MapInsets>({
    top: 180,
    right: 22,
    bottom: 320,
    left: 22,
  });
  const viewRef = useRef(view);
  const animation = useRef(0);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef({
    origin: [0, 0] as Point,
    moved: false,
    multiple: false,
    lastTime: 0,
    velocity: [0, 0] as Point,
  });
  const patternId = useId().replaceAll(":", "");

  function commit(next: MapViewState) {
    // A generous envelope keeps the campus recoverable after long flings.
    const value = {
      ...next,
      x: Math.max(-180, Math.min(180, next.x)),
      y: Math.max(-180, Math.min(180, next.y)),
    };
    viewRef.current = value;
    setView(value);
  }
  function cancelAnimation() {
    cancelAnimationFrame(animation.current);
  }
  function animateTo(next: MapViewState) {
    cancelAnimation();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      commit(next);
      return;
    }
    const from = viewRef.current,
      began = performance.now();
    const frame = (now: number) => {
      const time = Math.min(1, (now - began) / 280),
        eased = 1 - (1 - time) ** 3;
      commit({
        x: from.x + (next.x - from.x) * eased,
        y: from.y + (next.y - from.y) * eased,
        span: from.span + (next.span - from.span) * eased,
      });
      if (time < 1) animation.current = requestAnimationFrame(frame);
    };
    animation.current = requestAnimationFrame(frame);
  }
  function readInsets() {
    const rect = host.current!.getBoundingClientRect(),
      app = host.current!.parentElement;
    const header = app?.querySelector(".app-header")?.getBoundingClientRect();
    const sheet = app
      ?.querySelector(editing ? ".editor-sheet" : ".bottom-sheet")
      ?.getBoundingClientRect();
    const editor = app?.querySelector(".editor-top")?.getBoundingClientRect();
    const nav = app?.querySelector(".bottom-nav")?.getBoundingClientRect();
    const next: MapInsets =
      rect.width >= 850
        ? {
            left: Math.min(
              rect.width * 0.49,
              Math.max(header?.right ?? 0, sheet?.right ?? 0) - rect.left + 25,
            ),
            right: 78,
            top: 70,
            bottom: nav ? rect.bottom - nav.top + 24 : 80,
          }
        : {
            top:
              Math.max(header?.bottom ?? rect.top + 165, editor?.bottom ?? 0) -
              rect.top +
              18,
            right: 62,
            bottom: sheet
              ? rect.bottom - sheet.top + 18
              : nav
                ? rect.bottom - nav.top + 24
                : 110,
            left: 22,
          };
    next.bottom = Math.min(
      next.bottom,
      Math.max(100, rect.height - next.top - 110),
    );
    setInsets(next);
    return next;
  }
  function fit(kind: "campus" | "route" | "start" | "selection" = "route") {
    const safe = readInsets(),
      startRoom = features.find((room) => room.id === start) ?? features[0],
      selectedRoom = features.find((room) => room.id === selected);
    const points =
      kind === "start"
        ? [current ?? startRoom.middle]
        : kind === "selection" && selectedRoom
          ? (selectedRoom.polygon.outer as Point[])
          : kind !== "campus" && route.length > 1
            ? route
            : campusCorners;
    animateTo(
      fitMapPoints(
        points,
        size,
        safe,
        kind === "start" ? 52 : kind === "selection" ? 48 : 28,
      ),
    );
  }
  function zoom(
    factor: number,
    anchor: Point = [size.width / 2, size.height / 2],
  ) {
    animateTo(transformView(viewRef.current, size, anchor, anchor, factor));
  }
  function localPoint(clientX: number, clientY: number): Point {
    const rect = host.current!.getBoundingClientRect();
    return [clientX - rect.left, clientY - rect.top];
  }
  function fling() {
    cancelAnimation();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let velocity = [...gesture.current.velocity] as Point,
      last = performance.now(),
      elapsed = 0;
    const frame = (now: number) => {
      const delta = Math.min(32, now - last);
      last = now;
      elapsed += delta;
      const decay = Math.exp(-delta / 150);
      velocity = [velocity[0] * decay, velocity[1] * decay];
      const unit = viewRef.current.span / size.width;
      commit({
        ...viewRef.current,
        x: viewRef.current.x - velocity[0] * delta * unit,
        y: viewRef.current.y - velocity[1] * delta * unit,
      });
      if (elapsed < 750 && Math.hypot(...velocity) > 0.015)
        animation.current = requestAnimationFrame(frame);
    };
    if (Math.hypot(...velocity) > 0.04)
      animation.current = requestAnimationFrame(frame);
  }

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
      }),
    );
    if (host.current) observer.observe(host.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(animation.current);
    };
  }, []);
  useEffect(() => {
    const node = svg.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      cancelAnimation();
      const delta =
          event.deltaY *
          (event.deltaMode === 1
            ? 16
            : event.deltaMode === 2
              ? size.height
              : 1),
        anchor = localPoint(event.clientX, event.clientY);
      commit(
        transformView(
          viewRef.current,
          size,
          anchor,
          anchor,
          Math.exp(Math.max(-0.45, Math.min(0.45, delta * 0.0016))),
        ),
      );
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [size.width, size.height]);
  useEffect(() => {
    // Explicit fits never interrupt a gesture when the live navigation step changes.
    const frame = requestAnimationFrame(() =>
      fit(route.length > 1 ? "route" : selected ? "selection" : "campus"),
    );
    return () => cancelAnimationFrame(frame);
  }, [fitVersion, size.width, size.height]);
  useEffect(() => {
    setFocused(selected ?? start);
  }, [selected, start]);
  useEffect(() => {
    const observer = new ResizeObserver(() => readInsets());
    host.current?.parentElement
      ?.querySelectorAll(
        ".app-header,.bottom-sheet,.editor-top,.editor-sheet,.bottom-nav",
      )
      .forEach((node) => observer.observe(node));
    readInsets();
    return () => observer.disconnect();
  }, [
    selected,
    editing,
    route.length,
    Boolean(current),
    size.width,
    size.height,
  ]);

  const unit = view.span / size.width,
    height = unit * size.height;
  const startRoom = features.find((room) => room.id === start) ?? features[0],
    selectedRoom = features.find((room) => room.id === selected);
  const startPoint = current ?? route[0] ?? startRoom.middle,
    destination = route.at(-1) ?? selectedRoom?.middle;
  const scale = mapScale(view.span, size.width);
  const labelIds = useMemo(() => {
    if (!labels) return new Set<string>();
    const occupied: number[][] = [],
      ids = new Set<string>();
    const candidates = features
      .filter(
        (room) =>
          matches(room.kindLabel, filter) ||
          room.id === selected ||
          room.id === start,
      )
      .sort(
        (a, b) =>
          (b.id === selected ? 1e7 : b.id === start ? 1e6 : b.areaM2Region) -
          (a.id === selected ? 1e7 : a.id === start ? 1e6 : a.areaM2Region),
      );
    for (const room of candidates) {
      const [x, y] = room.middle;
      if (
        x < view.x - view.span / 2 ||
        x > view.x + view.span / 2 ||
        y < view.y - height / 2 ||
        y > view.y + height / 2
      )
        continue;
      const forced = room.id === selected || room.id === start;
      if (
        !forced &&
        ((room.areaM2Region < 28 && view.span > 90) ||
          (room.id.length > 8 && view.span > 100))
      )
        continue;
      const width = (room.id.length * 6.1 + 7) * unit,
        labelHeight = 17 * unit,
        box = [
          x - width / 2,
          y - labelHeight / 2,
          x + width / 2,
          y + labelHeight / 2,
        ];
      if (
        !forced &&
        occupied.some(
          (other) =>
            box[0] < other[2] &&
            box[2] > other[0] &&
            box[1] < other[3] &&
            box[3] > other[1],
        )
      )
        continue;
      occupied.push(box);
      ids.add(room.id);
    }
    return ids;
  }, [
    labels,
    filter,
    selected,
    start,
    unit,
    view.x,
    view.y,
    view.span,
    height,
  ]);

  function focusRoom(id: string, key: string) {
    const origin = features.find((room) => room.id === id)!;
    const direction: Point =
      key === "ArrowLeft"
        ? [-1, 0]
        : key === "ArrowRight"
          ? [1, 0]
          : key === "ArrowUp"
            ? [0, -1]
            : [0, 1];
    const next = features
      .filter((room) => room.id !== id && matches(room.kindLabel, filter))
      .map((room) => {
        const dx = room.middle[0] - origin.middle[0],
          dy = room.middle[1] - origin.middle[1];
        return {
          room,
          ahead: dx * direction[0] + dy * direction[1],
          score:
            Math.hypot(dx, dy) +
            Math.abs(dx * direction[1] - dy * direction[0]) * 1.6,
        };
      })
      .filter((candidate) => candidate.ahead > 0.1)
      .sort((a, b) => a.score - b.score)[0];
    if (next) {
      setFocused(next.room.id);
      roomElements.current.get(next.room.id)?.focus();
    }
  }

  return (
    <div
      className="map-stage atlas-map"
      ref={host}
      style={{ "--map-bottom-inset": `${insets.bottom}px` } as CSSProperties}
    >
      <svg
        ref={svg}
        role="group"
        aria-label="校园首层二维地图。拖动或双指缩放；键盘方向键移动，回车选择教室，加减号缩放。"
        tabIndex={0}
        className={`map-svg ${editing ? "editing" : ""} ${dragging ? "is-dragging" : ""}`}
        viewBox={`${view.x - view.span / 2} ${view.y - height / 2} ${view.span} ${height}`}
        onKeyDown={(event) => {
          if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            zoom(0.76);
          } else if (event.key === "-") {
            event.preventDefault();
            zoom(1.3);
          } else if (event.key === "Home") {
            event.preventDefault();
            fit("campus");
          } else if (event.key.startsWith("Arrow")) {
            event.preventDefault();
            cancelAnimation();
            const amount = viewRef.current.span * 0.15;
            commit({
              ...viewRef.current,
              x:
                viewRef.current.x +
                (event.key === "ArrowRight"
                  ? amount
                  : event.key === "ArrowLeft"
                    ? -amount
                    : 0),
              y:
                viewRef.current.y +
                (event.key === "ArrowDown"
                  ? amount
                  : event.key === "ArrowUp"
                    ? -amount
                    : 0),
            });
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          cancelAnimation();
          const p = localPoint(event.clientX, event.clientY);
          if (!pointers.current.size)
            gesture.current = {
              origin: p,
              moved: false,
              multiple: false,
              lastTime: performance.now(),
              velocity: [0, 0],
            };
          pointers.current.set(event.pointerId, p);
          if (pointers.current.size > 1) {
            gesture.current.multiple = true;
            gesture.current.moved = true;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!pointers.current.has(event.pointerId)) return;
          const previous = pointers.current.get(event.pointerId)!,
            oldPoints = [...pointers.current.values()],
            next = localPoint(event.clientX, event.clientY);
          pointers.current.set(event.pointerId, next);
          if (pointers.current.size >= 2) {
            const [oldA, oldB] = oldPoints,
              [newA, newB] = [...pointers.current.values()];
            const oldMiddle: Point = [
                (oldA[0] + oldB[0]) / 2,
                (oldA[1] + oldB[1]) / 2,
              ],
              newMiddle: Point = [
                (newA[0] + newB[0]) / 2,
                (newA[1] + newB[1]) / 2,
              ];
            const oldDistance = Math.hypot(
                oldA[0] - oldB[0],
                oldA[1] - oldB[1],
              ),
              newDistance = Math.hypot(newA[0] - newB[0], newA[1] - newB[1]);
            if (oldDistance > 4 && newDistance > 4)
              commit(
                transformView(
                  viewRef.current,
                  size,
                  oldMiddle,
                  newMiddle,
                  oldDistance / newDistance,
                ),
              );
            setDragging(true);
          } else {
            if (
              Math.hypot(
                next[0] - gesture.current.origin[0],
                next[1] - gesture.current.origin[1],
              ) > 5
            )
              gesture.current.moved = true;
            if (gesture.current.moved) {
              const now = performance.now(),
                elapsed = Math.max(8, now - gesture.current.lastTime),
                dx = next[0] - previous[0],
                dy = next[1] - previous[1];
              gesture.current.velocity = [
                gesture.current.velocity[0] * 0.45 + (dx / elapsed) * 0.55,
                gesture.current.velocity[1] * 0.45 + (dy / elapsed) * 0.55,
              ];
              gesture.current.lastTime = now;
              commit(transformView(viewRef.current, size, previous, next, 1));
              setDragging(true);
            }
          }
        }}
        onPointerUp={(event) => {
          if (!pointers.current.has(event.pointerId)) return;
          pointers.current.delete(event.pointerId);
          if (pointers.current.size) {
            gesture.current.velocity = [0, 0];
            return;
          }
          setDragging(false);
          if (!gesture.current.moved && !gesture.current.multiple) {
            const p = mapPoint(
              localPoint(event.clientX, event.clientY),
              viewRef.current,
              size,
            );
            if (editing) {
              if (
                p[0] >= bounds.x &&
                p[0] <= bounds.x + bounds.width &&
                p[1] >= bounds.y &&
                p[1] <= bounds.y + bounds.height
              )
                onPoint(p);
            } else {
              const room = document
                .elementFromPoint(event.clientX, event.clientY)
                ?.closest("[data-room]")
                ?.getAttribute("data-room");
              if (room) {
                setFocused(room);
                onSelect(room);
              }
            }
          } else if (
            !editing &&
            !gesture.current.multiple &&
            performance.now() - gesture.current.lastTime < 100
          )
            fling();
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          gesture.current.multiple = true;
          if (!pointers.current.size) setDragging(false);
        }}
        onLostPointerCapture={(event) => {
          pointers.current.delete(event.pointerId);
          if (!pointers.current.size) setDragging(false);
        }}
      >
        <defs>
          <pattern
            id={`${patternId}-dots`}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r=".075" fill="#aebdc4" />
          </pattern>
          <pattern
            id={`${patternId}-stairs`}
            width=".8"
            height=".8"
            patternUnits="userSpaceOnUse"
          >
            <path d="M0 0H.8" stroke="#c2cbd0" strokeWidth=".2" />
          </pattern>
        </defs>
        <rect
          x="-500"
          y="-500"
          width="1000"
          height="1000"
          fill={`url(#${patternId}-dots)`}
          pointerEvents="none"
        />
        <g className="map-ground" pointerEvents="none">
          <rect
            x={bounds.x - 3}
            y={bounds.y - 3}
            width={bounds.width + 6}
            height={bounds.height + 6}
            rx="4"
          />
          <text x={bounds.x + 1} y={bounds.y - 6}>
            MAC CAMPUS / FF—01
          </text>
        </g>
        {features.map((room) => {
          const match =
            matches(room.kindLabel, filter) ||
            room.id === selected ||
            room.id === start;
          const garden = room.kindLabel === "中庭花园",
            library = room.kindLabel === "图书与阅读",
            dining = room.kindLabel === "餐厅";
          return (
            <g
              key={room.id}
              ref={(element) => {
                if (element) roomElements.current.set(room.id, element);
                else roomElements.current.delete(room.id);
              }}
              data-room={room.id}
              role="button"
              aria-label={`${room.id}，${room.name}，${room.kindLabel}`}
              aria-pressed={selected === room.id}
              tabIndex={!editing && focused === room.id ? 0 : -1}
              onFocus={() => setFocused(room.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelect(room.id);
                } else if (event.key.startsWith("Arrow")) {
                  event.preventDefault();
                  event.stopPropagation();
                  focusRoom(room.id, event.key);
                }
              }}
              className={`room-shape ${selected === room.id ? "selected" : ""} ${room.id === start ? "start-room" : ""} ${garden ? "is-garden" : library ? "is-library" : dining ? "is-dining" : ""}`}
              opacity={match ? 1 : 0.19}
            >
              <title>
                {room.id} · {room.name}
              </title>
              <path
                d={room.path}
                fillRule="evenodd"
                fill={
                  room.kindLabel === "楼梯"
                    ? `url(#${patternId}-stairs)`
                    : garden
                      ? "#deeadc"
                      : library
                        ? "#e5ecf8"
                        : dining
                          ? "#f2eadc"
                          : "#fdfefd"
                }
                stroke="#bcc8ce"
                strokeWidth=".23"
              />
              {labelIds.has(room.id) && (
                <text
                  x={room.middle[0]}
                  y={room.middle[1]}
                  className="room-label"
                  style={{ fontSize: 10.3 * unit }}
                >
                  {room.id}
                </text>
              )}
            </g>
          );
        })}
        {route.length > 1 && (
          <g className="map-route" pointerEvents="none">
            <polyline
              points={route.map((point) => point.join(",")).join(" ")}
              fill="none"
              stroke="#183c6c18"
              strokeWidth={12 * unit}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <polyline
              points={route.map((point) => point.join(",")).join(" ")}
              fill="none"
              stroke="white"
              strokeWidth={8 * unit}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <polyline
              points={route.map((point) => point.join(",")).join(" ")}
              fill="none"
              stroke="#3268f4"
              strokeWidth={4.5 * unit}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {editing &&
              route.map((point, index) => (
                <g
                  key={index}
                  transform={`translate(${point[0]},${point[1]}) scale(${unit})`}
                >
                  <circle r="9" fill="white" stroke="#3268f4" strokeWidth="2" />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="9"
                    fontWeight="700"
                    fill="#3268f4"
                  >
                    {index + 1}
                  </text>
                </g>
              ))}
          </g>
        )}
        <g
          className={`map-marker ${current ? "is-guiding" : ""}`}
          transform={`translate(${startPoint[0]},${startPoint[1]}) scale(${unit})`}
        >
          <circle className="origin-halo" r="17" fill="#3268f418" />
          <circle r="8" fill="#3268f4" stroke="white" strokeWidth="3" />
          <circle r="2" fill="white" />
        </g>
        {route.length > 1 && !current && (
          <g
            transform={`translate(${startPoint[0]},${startPoint[1]}) scale(${unit})`}
            className="origin-label"
          >
            <rect x="-20" y="-39" width="40" height="21" rx="8" />
            <text y="-25">起点</text>
          </g>
        )}
        {selectedRoom && destination && (
          <g
            className="destination-marker"
            transform={`translate(${destination[0]},${destination[1]}) scale(${unit})`}
          >
            <ellipse cy="3" rx="10" ry="3" fill="#1d344c16" />
            <path
              d="M0 0C-4-5-12-13-12-20a12 12 0 0 1 24 0c0 7-8 15-12 20Z"
              fill="#142d48"
              stroke="white"
              strokeWidth="2.5"
            />
            <circle cy="-20" r="4" fill="white" />
          </g>
        )}
      </svg>
      <div className="map-caption">
        <span className="floor-pill">
          <Layers2 size={13} /> FF—01 <b>首层</b>
        </span>
        <span>
          {editing ? "点按地图添加路线点" : "校园图纸 · 手动选择起点"}
        </span>
      </div>
      <div className="map-tools" aria-label="地图工具">
        <button
          aria-label="重置图纸方向与视野"
          title="查看整个校园"
          onClick={() => fit("campus")}
        >
          <Compass size={20} />
        </button>
        <div className="zoom-group">
          <button
            aria-label="放大地图"
            disabled={view.span <= MIN_MAP_SPAN + 0.1}
            onClick={() => zoom(0.76)}
          >
            <Plus size={21} />
          </button>
          <button
            aria-label="缩小地图"
            disabled={view.span >= MAX_MAP_SPAN - 0.1}
            onClick={() => zoom(1.3)}
          >
            <Minus size={21} />
          </button>
        </div>
        <button
          aria-label="定位到所选起点"
          title="回到所选起点，非实时定位"
          onClick={() => fit("start")}
        >
          <LocateFixed size={21} />
        </button>
      </div>
      <div className="map-footer" aria-label="地图比例与来源">
        <div className="map-scale">
          <span style={{ width: `${scale.pixels}px` }} />
          <small>{scale.value} 图纸米</small>
        </div>
        <div className="map-attribution">FF-01 · 尺寸待核验 · 非实时定位</div>
      </div>
    </div>
  );
}

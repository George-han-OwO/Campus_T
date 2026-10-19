import { useEffect, useRef, useState } from "react";
import { Compass, LocateFixed, Minus, Plus } from "lucide-react";
import { bounds, center, rooms, type Point } from "./navigation";
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
  const [size, setSize] = useState({ width: 400, height: 800 });
  const [view, setView] = useState({ x: 0, y: 3, span: 146 });
  const gesture = useRef<{
    x: number;
    y: number;
    moved: boolean;
    pinch: number | null;
  }>({ x: 0, y: 0, moved: false, pinch: null });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (route.length) {
      const xs = route.map((p) => p[0]),
        ys = route.map((p) => p[1]);
      setView({
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2 + 15,
        span: Math.max(
          50,
          Math.max(...xs) - Math.min(...xs) + 22,
          ((Math.max(...ys) - Math.min(...ys) + 38) * size.width) / size.height,
        ),
      });
    } else setView({ x: 0, y: 3, span: 146 });
    // Explicit fit requests avoid moving the map during pointer gestures.
  }, [fitVersion]);
  const height = (view.span * size.height) / size.width;
  const point = (x: number, y: number): Point => {
    const rect = host.current!.getBoundingClientRect();
    return [
      view.x - view.span / 2 + ((x - rect.left) / size.width) * view.span,
      view.y - height / 2 + ((y - rect.top) / size.height) * height,
    ];
  };
  const zoom = (factor: number) =>
    setView((v) => ({
      ...v,
      span: Math.min(220, Math.max(18, v.span * factor)),
    }));
  const pan = (dx: number, dy: number) =>
    setView((v) => ({
      ...v,
      x: Math.max(-100, Math.min(100, v.x - (dx / size.width) * v.span)),
      y: Math.max(-90, Math.min(110, v.y - (dy / size.width) * v.span)),
    }));
  const startRoom = rooms.find((r) => r.id === start)!;
  const startPoint = current ?? route[0] ?? center(startRoom);
  return (
    <div className="map-stage" ref={host}>
      <svg
        role="img"
        aria-label="校园首层二维地图，可拖动缩放和选择教室"
        className={editing ? "map-svg editing" : "map-svg"}
        viewBox={`${view.x - view.span / 2} ${view.y - height / 2} ${view.span} ${height}`}
        onWheel={(e) => zoom(e.deltaY > 0 ? 1.12 : 0.89)}
        onPointerDown={(e) => {
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          gesture.current = {
            x: e.clientX,
            y: e.clientY,
            moved: false,
            pinch: null,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!pointers.current.has(e.pointerId)) return;
          const previous = pointers.current.get(e.pointerId)!;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (gesture.current.pinch)
              zoom(gesture.current.pinch / Math.max(1, d));
            gesture.current.pinch = d;
            gesture.current.moved = true;
          } else {
            if (
              Math.hypot(
                e.clientX - gesture.current.x,
                e.clientY - gesture.current.y,
              ) > 5
            )
              gesture.current.moved = true;
            if (gesture.current.moved)
              pan(e.clientX - previous.x, e.clientY - previous.y);
          }
        }}
        onPointerUp={(e) => {
          const moved = gesture.current.moved;
          pointers.current.delete(e.pointerId);
          gesture.current.pinch = null;
          if (!moved) {
            const p = point(e.clientX, e.clientY);
            if (
              editing &&
              p[0] >= bounds.x &&
              p[0] <= bounds.x + bounds.width &&
              p[1] >= bounds.y &&
              p[1] <= bounds.y + bounds.height
            )
              onPoint(p);
            else {
              const target = document
                .elementFromPoint(e.clientX, e.clientY)
                ?.closest("[data-room]")
                ?.getAttribute("data-room");
              if (target) onSelect(target);
            }
          }
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          gesture.current.pinch = null;
        }}
      >
        <defs>
          <pattern
            id="map-dots"
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r=".07" fill="#b8c1c8" />
          </pattern>
          <pattern
            id="stairs"
            width="1"
            height="1"
            patternUnits="userSpaceOnUse"
          >
            <path d="M0 0H1" stroke="#c2cbd0" strokeWidth=".25" />
          </pattern>
        </defs>
        <rect
          x="-250"
          y="-250"
          width="500"
          height="500"
          fill="url(#map-dots)"
        />
        <text x="-64" y="-57" className="plan-title">
          MAC CAMPUS / FF—01
        </text>
        {rooms.map((room) => {
          const c = center(room),
            garden = room.kindLabel === "中庭花园";
          const match =
            filter === "全部" ||
            (filter === "教室"
              ? room.kindLabel === "教室与书院"
              : filter === "阅读"
                ? room.kindLabel === "图书与阅读"
                : room.kindLabel === "餐厅");
          const d = [room.polygon.outer, ...room.polygon.holes]
            .map(
              (ring) =>
                ring
                  .map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`)
                  .join(" ") + "Z",
            )
            .join(" ");
          return (
            <g
              key={room.id}
              data-room={room.id}
              className={`room-shape ${selected === room.id ? "selected" : ""} ${room.id === start ? "start-room" : ""}`}
              opacity={match ? 1 : 0.24}
            >
              <path
                d={d}
                fillRule="evenodd"
                fill={
                  room.kindLabel === "楼梯"
                    ? "url(#stairs)"
                    : garden
                      ? "#dce8d8"
                      : "#fdfdfc"
                }
                stroke="#bdc7cb"
                strokeWidth=".24"
              />
              {labels &&
                (view.span < 125 ||
                  room.id === selected ||
                  room.id === "M104" ||
                  room.areaM2Region > 70) && (
                  <text
                    x={c[0]}
                    y={c[1]}
                    className="room-label"
                    style={{
                      fontSize: Math.min(2, Math.max(1.2, view.span / 77)),
                    }}
                  >
                    {room.id}
                  </text>
                )}
            </g>
          );
        })}
        {route.length > 1 && (
          <>
            <polyline
              points={route.map((p) => p.join(",")).join(" ")}
              fill="none"
              stroke="white"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            <polyline
              points={route.map((p) => p.join(",")).join(" ")}
              fill="none"
              stroke="#3268f4"
              strokeWidth="1.5"
              strokeLinejoin="round"
              className="route-line"
            />
            {editing &&
              route.map((p, i) => (
                <circle
                  key={i}
                  cx={p[0]}
                  cy={p[1]}
                  r=".9"
                  fill="white"
                  stroke="#3268f4"
                  strokeWidth=".5"
                />
              ))}
          </>
        )}
        <g className="map-marker">
          <circle
            cx={startPoint[0]}
            cy={startPoint[1]}
            r="3"
            fill="#3268f422"
          />
          <circle
            cx={startPoint[0]}
            cy={startPoint[1]}
            r="1.5"
            fill="#3268f4"
            stroke="white"
            strokeWidth=".6"
          />
        </g>
        {selected && (
          <g
            className="destination-marker"
            transform={`translate(${(route.at(-1) ?? center(rooms.find((r) => r.id === selected)!))[0]},${(route.at(-1) ?? center(rooms.find((r) => r.id === selected)!))[1]})`}
          >
            <path
              d="M0 0C-1-1.5-3-3.5-3-5A3 3 0 0 1 3-5C3-3.5 1-1.5 0 0Z"
              fill="#152a40"
              stroke="white"
              strokeWidth=".5"
            />
            <circle cy="-5" r="1" fill="white" />
          </g>
        )}
      </svg>
      <div className="map-caption">
        <span className="floor-pill">
          FF—01 <b>首层</b>
        </span>
        <span>图纸坐标 · 非实时定位</span>
      </div>
      <div className="map-tools">
        <button
          aria-label="重置图纸方向与视野"
          onClick={() => setView({ x: 0, y: 3, span: 146 })}
        >
          <Compass size={20} />
        </button>
        <div className="zoom-group">
          <button aria-label="放大地图" onClick={() => zoom(0.76)}>
            <Plus size={20} />
          </button>
          <button aria-label="缩小地图" onClick={() => zoom(1.3)}>
            <Minus size={20} />
          </button>
        </div>
        <button
          aria-label="定位到所选起点"
          onClick={() => {
            const c = center(startRoom);
            setView({ x: c[0], y: c[1] + 10, span: 52 });
          }}
        >
          <LocateFixed size={21} />
        </button>
      </div>
      <div className="map-attribution">
        校园 FF-01 图纸 · 位置与尺寸待现场核验
      </div>
    </div>
  );
}

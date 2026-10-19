import source from "./data/rooms.json";
export type Point = [number, number];
export type Room = {
  id: string;
  name: string;
  kindLabel: string;
  areaM2Region: number;
  polygon: { outer: number[][]; holes: number[][][] };
};
export const rooms = source as Room[];
export const bounds = { x: -73, y: -59, width: 147, height: 124 };
export type SavedRoute = {
  id: string;
  from: string;
  to: string;
  points: Point[];
  verified: boolean;
  updatedAt: string;
};
export type Step = {
  point: Point;
  text: string;
  turn: "start" | "left" | "right" | "straight" | "arrive";
  distance: number;
};
export const distance = (a: Point, b: Point) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);
export function center(room: Room): Point {
  const p = room.polygon.outer;
  return [
    (Math.min(...p.map((v) => v[0])) + Math.max(...p.map((v) => v[0]))) / 2,
    (Math.min(...p.map((v) => v[1])) + Math.max(...p.map((v) => v[1]))) / 2,
  ];
}
export function inside(point: Point, polygon: number[][]) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i],
      [xj, yj] = polygon[j];
    if (
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    )
      hit = !hit;
  }
  return hit;
}
export function contains(room: Room, point: Point) {
  return (
    inside(point, room.polygon.outer) &&
    !room.polygon.holes.some((h) => inside(point, h))
  );
}
const W = Math.ceil(bounds.width),
  H = Math.ceil(bounds.height);
const toPoint = (id: number): Point => [
  bounds.x + (id % W) + 0.5,
  bounds.y + Math.floor(id / W) + 0.5,
];
let occupancy: Uint8Array | undefined;
export function grid() {
  if (occupancy) return occupancy;
  occupancy = new Uint8Array(W * H);
  for (const room of rooms) {
    const pts = room.polygon.outer;
    const minX = Math.max(
      0,
      Math.floor(Math.min(...pts.map((p) => p[0])) - bounds.x),
    );
    const maxX = Math.min(
      W - 1,
      Math.ceil(Math.max(...pts.map((p) => p[0])) - bounds.x),
    );
    const minY = Math.max(
      0,
      Math.floor(Math.min(...pts.map((p) => p[1])) - bounds.y),
    );
    const maxY = Math.min(
      H - 1,
      Math.ceil(Math.max(...pts.map((p) => p[1])) - bounds.y),
    );
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const p = toPoint(y * W + x);
        if (
          [
            [0, 0],
            [-0.45, -0.45],
            [-0.45, 0.45],
            [0.45, -0.45],
            [0.45, 0.45],
          ].some(([dx, dy]) => contains(room, [p[0] + dx, p[1] + dy]))
        )
          occupancy[y * W + x] = 1;
      }
  }
  return occupancy;
}
function portals(room: Room, blocked: Uint8Array) {
  const cells = new Set<number>();
  const polygon = room.polygon.outer;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Point,
      b = polygon[(i + 1) % polygon.length] as Point;
    const count = Math.max(1, Math.ceil(distance(a, b)));
    for (let t = 0; t <= count; t++) {
      const x = Math.floor(a[0] + ((b[0] - a[0]) * t) / count - bounds.x);
      const y = Math.floor(a[1] + ((b[1] - a[1]) * t) / count - bounds.y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy,
            id = ny * W + nx;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H && !blocked[id])
            cells.add(id);
        }
    }
  }
  return [...cells];
}
class Heap {
  items: { id: number; score: number }[] = [];
  push(item: { id: number; score: number }) {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].score <= item.score) break;
      this.items[i] = this.items[parent];
      i = parent;
    }
    this.items[i] = item;
  }
  pop() {
    const first = this.items[0],
      last = this.items.pop()!;
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let child = i * 2 + 1;
        if (
          child + 1 < this.items.length &&
          this.items[child + 1].score < this.items[child].score
        )
          child++;
        if (last.score <= this.items[child].score) break;
        this.items[i] = this.items[child];
        i = child;
      }
      this.items[i] = last;
    }
    return first;
  }
}
/** Geometry-only preview. Doors, accessible paths and building boundaries are NOT inferred as verified routes. */
export function planPreview(from: Room, to: Room): Point[] | null {
  if (from.id === to.id) return null;
  const blocked = grid(),
    starts = portals(from, blocked),
    goals = new Set(portals(to, blocked));
  if (!starts.length || !goals.size) return null;
  const scores = new Float64Array(W * H).fill(Infinity),
    previous = new Int32Array(W * H).fill(-1),
    closed = new Uint8Array(W * H);
  const goalPoints = [...goals].map(toPoint);
  const gx = [
    Math.min(...goalPoints.map((p) => p[0])),
    Math.max(...goalPoints.map((p) => p[0])),
  ];
  const gy = [
    Math.min(...goalPoints.map((p) => p[1])),
    Math.max(...goalPoints.map((p) => p[1])),
  ];
  const heuristic = (id: number) => {
    const p = toPoint(id);
    return Math.hypot(
      Math.max(gx[0] - p[0], 0, p[0] - gx[1]),
      Math.max(gy[0] - p[1], 0, p[1] - gy[1]),
    );
  };
  const queue = new Heap();
  starts.forEach((id) => {
    scores[id] = 0;
    queue.push({ id, score: heuristic(id) });
  });
  while (queue.items.length) {
    const { id } = queue.pop();
    if (closed[id]) continue;
    closed[id] = 1;
    if (goals.has(id)) {
      const path: Point[] = [];
      for (let at = id; at >= 0; at = previous[at]) path.push(toPoint(at));
      return smooth(path.reverse());
    }
    const x = id % W,
      y = Math.floor(id / W);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const next = ny * W + nx;
        if (
          blocked[next] ||
          closed[next] ||
          (dx && dy && (blocked[y * W + nx] || blocked[ny * W + x]))
        )
          continue;
        const score = scores[id] + Math.hypot(dx, dy);
        if (score < scores[next]) {
          scores[next] = score;
          previous[next] = id;
          queue.push({ id: next, score: score + heuristic(next) });
        }
      }
  }
  return null;
}
export function simplify(points: Point[]): Point[] {
  if (points.length < 3) return points;
  return points.filter((p, i) => {
    if (!i || i === points.length - 1) return true;
    const a = points[i - 1],
      b = points[i + 1];
    return (
      Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) >
      0.01
    );
  });
}
export function segmentClear(a: Point, b: Point) {
  const blocked = grid(),
    samples = Math.max(1, Math.ceil(distance(a, b) * 10));
  let previousX = Math.floor(a[0] - bounds.x),
    previousY = Math.floor(a[1] - bounds.y);
  for (let i = 0; i <= samples; i++) {
    const x = Math.floor(a[0] + ((b[0] - a[0]) * i) / samples - bounds.x),
      y = Math.floor(a[1] + ((b[1] - a[1]) * i) / samples - bounds.y);
    if (x < 0 || x >= W || y < 0 || y >= H || blocked[y * W + x]) return false;
    if (
      x !== previousX &&
      y !== previousY &&
      (blocked[previousY * W + x] || blocked[y * W + previousX])
    )
      return false;
    previousX = x;
    previousY = y;
  }
  return true;
}
function smooth(points: Point[]) {
  if (points.length < 3) return points;
  const result: Point[] = [points[0]];
  let index = 0;
  while (index < points.length - 1) {
    let next = index + 1;
    for (let j = points.length - 1; j > index + 1; j--)
      if (segmentClear(points[index], points[j])) {
        next = j;
        break;
      }
    result.push(points[next]);
    index = next;
  }
  return result;
}
export function stepsFor(points: Point[], from: string, to: string): Step[] {
  return points.map((p, i) => {
    const next = points[i + 1],
      previous = points[i - 1];
    let turn: Step["turn"] = i === 0 ? "start" : !next ? "arrive" : "straight";
    if (previous && next) {
      const cross =
        (p[0] - previous[0]) * (next[1] - p[1]) -
        (p[1] - previous[1]) * (next[0] - p[0]);
      const dot =
        (p[0] - previous[0]) * (next[0] - p[0]) +
        (p[1] - previous[1]) * (next[1] - p[1]);
      if (Math.abs(Math.atan2(cross, dot)) > 0.4)
        turn = cross > 0 ? "right" : "left";
    }
    const text =
      turn === "start"
        ? `从 ${from} 的路线起点出发`
        : turn === "arrive"
          ? `到达 ${to} 附近，请核对教室门牌`
          : turn === "left"
            ? "在此处向左转"
            : turn === "right"
              ? "在此处向右转"
              : "沿当前方向继续前行";
    return { point: p, turn, text, distance: next ? distance(p, next) : 0 };
  });
}
export function routeLength(points: Point[]) {
  return points.reduce(
    (n, p, i) => n + (i ? distance(points[i - 1], p) : 0),
    0,
  );
}
export function isRoute(value: unknown): value is SavedRoute {
  const r = value as SavedRoute;
  return Boolean(
    r &&
      typeof r.id === "string" &&
      rooms.some((room) => room.id === r.from) &&
      rooms.some((room) => room.id === r.to) &&
      r.from !== r.to &&
      typeof r.verified === "boolean" &&
      typeof r.updatedAt === "string" &&
      Number.isFinite(Date.parse(r.updatedAt)) &&
      Array.isArray(r.points) &&
      r.points.length >= 2 &&
      r.points.length <= 500 &&
      r.points.every(
        (p) =>
          Array.isArray(p) &&
          p.length === 2 &&
          p.every(Number.isFinite) &&
          p[0] >= bounds.x &&
          p[0] <= bounds.x + bounds.width &&
          p[1] >= bounds.y &&
          p[1] <= bounds.y + bounds.height,
      ),
  );
}
export function loadStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

import { loadStored, rooms, store } from "./navigation";

export type Journey = {
  id: string;
  from: string;
  to: string;
  distance: number;
  completedAt: string;
  mode: "preview" | "confirmed";
  stepCount: number;
};

const STORAGE = "atlas-go-journeys-v1";
const roomIds = new Set(rooms.map((room) => room.id));
const LIMIT = 20;

export class JourneyStorageError extends Error {
  constructor() {
    super("行程记录未能保存，请检查设备存储空间或访问权限");
    this.name = "JourneyStorageError";
  }
}

function isEntry(value: unknown): value is Omit<Journey, "id" | "completedAt"> {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Journey>;
  return (
    typeof item.from === "string" &&
    roomIds.has(item.from) &&
    typeof item.to === "string" &&
    roomIds.has(item.to) &&
    item.from !== item.to &&
    typeof item.distance === "number" &&
    Number.isFinite(item.distance) &&
    item.distance >= 0 &&
    (item.mode === "preview" || item.mode === "confirmed") &&
    typeof item.stepCount === "number" &&
    Number.isSafeInteger(item.stepCount) &&
    item.stepCount >= 1
  );
}

export function isJourney(value: unknown): value is Journey {
  if (!isEntry(value)) return false;
  const item = value as Journey;
  if (
    typeof item.id !== "string" ||
    !item.id.trim() ||
    item.id.length > 128 ||
    typeof item.completedAt !== "string"
  )
    return false;
  const time = Date.parse(item.completedAt);
  // This local format uses canonical UTC timestamps; reject rollover dates and
  // ambiguous locale strings so history order is stable on every device.
  return (
    Number.isFinite(time) &&
    new Date(time).toISOString() === item.completedAt
  );
}

function recent(items: Journey[]): Journey[] {
  const seen = new Set<string>();
  return items
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, LIMIT)
    .map(({ id, from, to, distance, completedAt, mode, stepCount }) => ({
      id,
      from,
      to,
      distance,
      completedAt,
      mode,
      stepCount,
    }));
}

export function loadJourneys(): Journey[] {
  const stored = loadStored<unknown>(STORAGE, []);
  return Array.isArray(stored) ? recent(stored.filter(isJourney)) : [];
}

export function recordJourney(
  entry: Omit<Journey, "id" | "completedAt">,
): { journey: Journey; history: Journey[] } {
  if (!isEntry(entry)) throw new TypeError("行程信息无效，无法保存");
  const completedAt = new Date().toISOString();
  const item: Journey = {
    id:
      globalThis.crypto?.randomUUID?.() ??
      `journey-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    from: entry.from,
    to: entry.to,
    distance: entry.distance,
    completedAt,
    mode: entry.mode,
    stepCount: entry.stepCount,
  };
  // Always retain this completion even if the device clock moved backwards.
  const next = recent([item, ...loadJourneys().slice(0, LIMIT - 1)]);
  if (!store(STORAGE, next)) throw new JourneyStorageError();
  return { journey: item, history: next };
}

export function saveJourney(entry: Omit<Journey, "id" | "completedAt">): Journey[] {
  return recordJourney(entry).history;
}

export function clearJourneys(): void {
  try {
    localStorage.removeItem(STORAGE);
  } catch {
    throw new JourneyStorageError();
  }
}

export function estimatedMinutes(distance: number): number {
  if (!Number.isFinite(distance) || distance < 0)
    throw new RangeError("距离必须为大于或等于零的有限数值");
  return Math.max(1, Math.ceil(distance / 80));
}

import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  clearJourneys,
  estimatedMinutes,
  isJourney,
  JourneyStorageError,
  loadJourneys,
  saveJourney,
  recordJourney,
  type Journey,
} from "./journeys";

const KEY = "atlas-go-journeys-v1";
const valid: Journey = {
  id: "trip-1",
  from: "M104",
  to: "A101",
  distance: 176,
  completedAt: "2026-10-23T02:00:00.000Z",
  mode: "preview",
  stepCount: 11,
};

function storage(values = new Map<string, string>()) {
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

function useStorage(t: TestContext, instance: ReturnType<typeof storage>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: instance,
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
}

test('a clock correction cannot replace the arrival result or drop the new completion', t => {
  const future = Array.from({length:20},(_,i)=>({...valid,id:`future-${i}`,completedAt:new Date(Date.UTC(2099,0,1,0,i)).toISOString()}));
  const values = new Map([[KEY,JSON.stringify(future)]]);
  useStorage(t,storage(values));
  const result=recordJourney({from:'A101',to:'M104',distance:176,stepCount:11,mode:'confirmed'});
  assert.equal(result.journey.to,'M104');
  assert.equal(result.journey.mode,'confirmed');
  assert.equal(result.history.length,20);
  assert.notEqual(result.history[0].id,result.journey.id);
  assert.ok(loadJourneys().some(item=>item.id===result.journey.id));
});

test("history rejects broken data without discarding valid trips", (t) => {
  const invalid = [
    null,
    { ...valid, id: " " },
    { ...valid, from: "NO-SUCH-ROOM" },
    { ...valid, to: "M104" },
    { ...valid, distance: -2 },
    { ...valid, distance: "176" },
    { ...valid, mode: "live" },
    { ...valid, stepCount: 0 },
    { ...valid, stepCount: 1.5 },
    { ...valid, completedAt: "not-a-date" },
    { ...valid, completedAt: "2026-02-30T02:00:00.000Z" },
  ];
  const values = new Map([[KEY, JSON.stringify([...invalid, valid])]]);
  useStorage(t, storage(values));
  assert.deepEqual(loadJourneys(), [valid]);
  assert.equal(isJourney({ ...valid, distance: Infinity }), false);
  assert.equal(isJourney({ ...valid, distance: NaN }), false);
});

test("history is recent first, capped, and keeps repeated journeys with distinct IDs", (t) => {
  const trips = Array.from({ length: 24 }, (_, index) => ({
    ...valid,
    id: `trip-${index}`,
    completedAt: new Date(Date.UTC(2026, 9, 23, 0, index)).toISOString(),
  }));
  const duplicate = { ...trips[23], completedAt: trips[0].completedAt };
  const values = new Map([[KEY, JSON.stringify([duplicate, ...trips])]]);
  useStorage(t, storage(values));
  const history = loadJourneys();
  assert.equal(history.length, 20);
  assert.equal(history[0].id, "trip-23");
  assert.equal(history[0].completedAt, trips[23].completedAt);
  assert.equal(history.at(-1)?.id, "trip-4");
  assert.equal(new Set(history.map((item) => item.id)).size, 20);
});

test("saving a repeated route records each completion and clearing retains unrelated preferences", (t) => {
  const values = new Map([["atlas-go-voice", "true"]]);
  useStorage(t, storage(values));
  const { id: _id, completedAt: _time, ...entry } = valid;
  const first = saveJourney(entry);
  const second = saveJourney({ ...entry, mode: "confirmed" });
  assert.equal(first.length, 1);
  assert.equal(second.length, 2);
  assert.notEqual(second[0].id, second[1].id);
  assert.equal(second[0].mode, "confirmed");
  assert.equal(second[1].mode, "preview");
  assert.deepEqual(loadJourneys(), second);
  clearJourneys();
  assert.deepEqual(loadJourneys(), []);
  assert.equal(values.get("atlas-go-voice"), "true");
});

test("storage corruption and denied access do not crash reads or report unsaved trips as saved", (t) => {
  const values = new Map([[KEY, "{broken-json"]]);
  const mockStorage = storage(values);
  useStorage(t, mockStorage);
  assert.deepEqual(loadJourneys(), []);
  const original = JSON.stringify([valid]);
  values.set(KEY, original);
  mockStorage.setItem = () => {
    throw new Error("quota exceeded");
  };
  mockStorage.removeItem = () => {
    throw new Error("access denied");
  };
  const { id: _id, completedAt: _time, ...entry } = valid;
  assert.throws(() => saveJourney(entry), JourneyStorageError);
  assert.equal(values.get(KEY), original);
  assert.throws(() => clearJourneys(), JourneyStorageError);
  mockStorage.getItem = () => {
    throw new Error("access denied");
  };
  assert.deepEqual(loadJourneys(), []);
});

test("invalid completion cannot be persisted and walking estimate rounds up", (t) => {
  const values = new Map<string, string>();
  useStorage(t, storage(values));
  const { id: _id, completedAt: _time, ...entry } = valid;
  assert.throws(() => saveJourney({ ...entry, to: "UNKNOWN" }), TypeError);
  assert.equal(values.size, 0);
  assert.equal(estimatedMinutes(0), 1);
  assert.equal(estimatedMinutes(80), 1);
  assert.equal(estimatedMinutes(81), 2);
  assert.equal(estimatedMinutes(176), 3);
  assert.throws(() => estimatedMinutes(Infinity), RangeError);
  assert.throws(() => estimatedMinutes(-1), RangeError);
});

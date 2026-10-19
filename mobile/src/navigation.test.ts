import test from "node:test";
import assert from "node:assert/strict";
import {
  contains,
  distance,
  isRoute,
  planPreview,
  rooms,
  segmentClear,
  stepsFor,
  type Point,
} from "./navigation";

test("bundled plan has 159 uniquely addressed spaces and the real M104 room", () => {
  assert.equal(rooms.length, 159);
  assert.equal(new Set(rooms.map((r) => r.id)).size, rooms.length);
  assert.equal(rooms.find((r) => r.id === "M104")?.name, "一小步空间");
});
test("M104 to A101 preview follows free grid cells and smoothing does not cross rooms", () => {
  const path = planPreview(
    rooms.find((r) => r.id === "M104")!,
    rooms.find((r) => r.id === "A101")!,
  );
  assert.ok(path && path.length >= 2);
  assert.ok(
    path.length < 25,
    "raster staircases should not create dozens of turn instructions",
  );
  path.forEach((point, i) => {
    assert.ok(
      !rooms.some((room) => contains(room, point)),
      "route checkpoint cannot be inside a room",
    );
    if (!i) return;
    const previous = path[i - 1];
    assert.ok(segmentClear(previous, point));
    const count = Math.ceil(distance(previous, point) * 10);
    for (let j = 0; j <= count; j++) {
      const p: Point = [
        previous[0] + ((point[0] - previous[0]) * j) / count,
        previous[1] + ((point[1] - previous[1]) * j) / count,
      ];
      assert.ok(
        !rooms.some((room) => contains(room, p)),
        "smoothed segment cannot cut through a room polygon",
      );
    }
  });
});
test("same-room query does not invent a route", () => {
  const room = rooms.find((r) => r.id === "M104")!;
  assert.equal(planPreview(room, room), null);
});
test("turn instructions use the screen-coordinate convention and terminate at destination", () => {
  const steps = stepsFor(
    [
      [0, 0],
      [2, 0],
      [2, 2],
      [4, 2],
    ],
    "M104",
    "A101",
  );
  assert.deepEqual(
    steps.map((s) => s.turn),
    ["start", "right", "left", "arrive"],
  );
  assert.match(steps.at(-1)!.text, /A101/);
  assert.equal(steps.at(-1)!.distance, 0);
});
test("import validation rejects unknown rooms, out-of-plan coordinates and missing verification flag", () => {
  const valid = {
    id: "test",
    from: "M104",
    to: "A101",
    points: [
      [0, 0],
      [1, 1],
    ],
    verified: false,
    updatedAt: new Date().toISOString(),
  };
  assert.ok(isRoute(valid));
  assert.ok(!isRoute({ ...valid, to: "UNKNOWN" }));
  assert.ok(!isRoute({ ...valid, to: "M104" }));
  assert.ok(
    !isRoute({
      ...valid,
      points: [
        [0, 0],
        [900, 1000],
      ],
    }),
  );
  assert.ok(!isRoute({ ...valid, verified: undefined }));
  assert.ok(
    !isRoute({
      ...valid,
      points: [
        [0, 0],
        [NaN, 1],
      ],
    }),
  );
});

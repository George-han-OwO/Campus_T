import test from "node:test";
import assert from "node:assert/strict";
import {
  fitMapPoints,
  mapPoint,
  mapScale,
  transformView,
  MIN_MAP_SPAN,
  MAX_MAP_SPAN,
} from "./mapViewport";
import type { Point } from "./navigation";

const size = { width: 412, height: 892 };
const close = (actual: Point, expected: Point) =>
  actual.forEach((number, index) =>
    assert.ok(Math.abs(number - expected[index]) < 1e-8),
  );

test("wheel zoom preserves a blueprint point under an off-center pointer", () => {
  const view = { x: 7, y: -11, span: 146 },
    pointer: Point = [81, 289];
  close(
    mapPoint(pointer, transformView(view, size, pointer, pointer, 0.7), size),
    mapPoint(pointer, view, size),
  );
});
test("pinch both scales and pans around the moving finger midpoint", () => {
  const view = { x: 7, y: -11, span: 146 },
    before: Point = [100, 360],
    after: Point = [173, 315];
  close(
    mapPoint(after, transformView(view, size, before, after, 0.5), size),
    mapPoint(before, view, size),
  );
});
test("zoom limits preserve the anchor without a jump at either limit", () => {
  const view = { x: 0, y: 3, span: 146 },
    pointer: Point = [91, 212];
  const minimum = transformView(view, size, pointer, pointer, 0.001),
    maximum = transformView(view, size, pointer, pointer, 100);
  assert.equal(minimum.span, MIN_MAP_SPAN);
  assert.equal(maximum.span, MAX_MAP_SPAN);
  close(mapPoint(pointer, minimum, size), mapPoint(pointer, view, size));
  close(mapPoint(pointer, maximum, size), mapPoint(pointer, view, size));
});
test("a route fit leaves all checkpoints between the search header and bottom sheet", () => {
  const points: Point[] = [
      [-30, -40],
      [26, -8],
      [41, 18],
    ],
    insets = { top: 190, right: 62, bottom: 360, left: 22 };
  const view = fitMapPoints(points, size, insets);
  for (const point of points) {
    const x = size.width / 2 + ((point[0] - view.x) / view.span) * size.width;
    const y = size.height / 2 + ((point[1] - view.y) / view.span) * size.width;
    assert.ok(x > insets.left && x < size.width - insets.right);
    assert.ok(y > insets.top && y < size.height - insets.bottom);
  }
});
test("map scale remains readable across the full supported zoom range", () => {
  for (const span of [MIN_MAP_SPAN, 52, 146, MAX_MAP_SPAN]) {
    const scale = mapScale(span, size.width);
    assert.ok(scale.value > 0 && scale.pixels >= 70 && scale.pixels < 180);
  }
});

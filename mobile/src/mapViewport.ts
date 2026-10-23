import type { Point } from "./navigation";

export type MapViewState = { x: number; y: number; span: number };
export type MapSize = { width: number; height: number };
export type MapInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};
export const MIN_MAP_SPAN = 18;
export const MAX_MAP_SPAN = 260;

export function mapPoint(
  pixel: Point,
  view: MapViewState,
  size: MapSize,
): Point {
  const unit = view.span / Math.max(1, size.width);
  return [
    view.x + (pixel[0] - size.width / 2) * unit,
    view.y + (pixel[1] - size.height / 2) * unit,
  ];
}

/** Preserve the blueprint coordinate under a moving pinch or wheel anchor. */
export function transformView(
  view: MapViewState,
  size: MapSize,
  oldAnchor: Point,
  newAnchor: Point,
  factor: number,
): MapViewState {
  const anchor = mapPoint(oldAnchor, view, size);
  const span = Math.min(
    MAX_MAP_SPAN,
    Math.max(MIN_MAP_SPAN, view.span * factor),
  );
  const unit = span / Math.max(1, size.width);
  return {
    x: anchor[0] - (newAnchor[0] - size.width / 2) * unit,
    y: anchor[1] - (newAnchor[1] - size.height / 2) * unit,
    span,
  };
}

/** Fit in the uncovered part of the map, above the sheet and below search. */
export function fitMapPoints(
  points: Point[],
  size: MapSize,
  insets: MapInsets,
  minSpan = 28,
): MapViewState {
  if (!points.length) return { x: 0, y: 3, span: 146 };
  const xs = points.map((point) => point[0]),
    ys = points.map((point) => point[1]);
  const availableWidth = Math.max(80, size.width - insets.left - insets.right);
  const availableHeight = Math.max(
    80,
    size.height - insets.top - insets.bottom,
  );
  const span = Math.min(
    MAX_MAP_SPAN,
    Math.max(
      MIN_MAP_SPAN,
      minSpan,
      ((Math.max(...xs) - Math.min(...xs) + 8) * size.width) / availableWidth,
      ((Math.max(...ys) - Math.min(...ys) + 8) * size.width) / availableHeight,
    ),
  );
  const visibleCenter: Point = [
    insets.left + availableWidth / 2,
    insets.top + availableHeight / 2,
  ];
  const unit = span / Math.max(1, size.width);
  return {
    x:
      (Math.min(...xs) + Math.max(...xs)) / 2 -
      (visibleCenter[0] - size.width / 2) * unit,
    y:
      (Math.min(...ys) + Math.max(...ys)) / 2 -
      (visibleCenter[1] - size.height / 2) * unit,
    span,
  };
}

/** A readable 1 / 2 / 5 scale in unverified blueprint units. */
export function mapScale(span: number, width: number) {
  const target = (span / Math.max(1, width)) * 70;
  const order = 10 ** Math.floor(Math.log10(Math.max(0.01, target)));
  const value =
    [1, 2, 5, 10]
      .map((factor) => factor * order)
      .find((value) => value >= target) ?? order * 10;
  return { value, pixels: (value * width) / span };
}

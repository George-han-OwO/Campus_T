const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800].map(value => value * 1000);

/** Fit sparse observations to a readable time axis without inventing samples. */
export function chartTimeScale(times: number[], rangeStart: number, rangeEnd: number) {
  const valid = times.filter(Number.isFinite).sort((a, b) => a - b);
  let start = rangeStart;
  let end = Math.max(rangeEnd, start + 1000);
  let zoomed = false;
  if (valid.length) {
    const first = valid[0];
    const last = valid[valid.length - 1];
    const span = last - first;
    if (span < (end - start) * .75) {
      const padding = Math.max(15_000, span * .08);
      const desired = Math.max(60_000, span + padding * 2);
      const step = steps.find(value => value >= desired / 4) ?? 86400000;
      start = Math.floor((first - padding) / step) * step;
      end = Math.ceil((last + padding) / step) * step;
      if (end - start < 60_000) { start -= step; end += step; }
      zoomed = true;
    }
  }
  const target = (end - start) / 4;
  const step = steps.find(value => value >= target) ?? 86400000;
  const ticks = [start];
  for (let time = Math.ceil((start + 1) / step) * step; time < end; time += step) {
    if (time - start >= step * .35 && end - time >= step * .35) ticks.push(time);
  }
  ticks.push(end);
  return { start, end, ticks, zoomed, seconds: step < 60_000 };
}

export function chartTimeLabel(time: number, seconds: boolean, includeDate = false) {
  return new Date(time).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai", hour12: false,
    ...(includeDate ? { month: "2-digit", day: "2-digit" } as const : {}),
    hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } as const : {}),
  });
}

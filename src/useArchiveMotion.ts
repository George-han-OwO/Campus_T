import { useCallback, useEffect, useRef, useState } from "react";

/** Continuous spring position in record units; selection snaps to whole records. */
export function useArchiveMotion(index: number, count: number, onSelect: (index: number) => void) {
  const [position, setPosition] = useState<number | null>(null);
  const state = useRef({ x: 0, target: 0, velocity: 0, time: 0, running: false });
  const frame = useRef(0);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ index, count, onSelect });
  latest.current = { index, count, onSelect };
  const reduced = useRef(false);

  const cancel = useCallback(() => {
    cancelAnimationFrame(frame.current);
    clearTimeout(snapTimer.current);
    state.current.running = false;
    state.current.velocity = 0;
    setPosition(null);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced.current = media.matches;
    const change = () => { reduced.current = media.matches; cancel(); };
    media.addEventListener("change", change);
    return () => { media.removeEventListener("change", change); cancelAnimationFrame(frame.current); clearTimeout(snapTimer.current); };
  }, [cancel]);

  const advance = useCallback((pixels: number) => {
    if (!latest.current.count || !Number.isFinite(pixels)) return;
    const current = state.current;
    const limit = latest.current.count - 1;
    const clamp = (value: number) => Math.max(0, Math.min(limit, value));
    if (!current.running) {
      current.x = Math.max(0, latest.current.index);
      current.target = current.x;
      current.velocity = 0;
      current.time = performance.now();
      current.running = true;
    }
    // A wheel detent advances roughly one layer; trackpad deltas stay continuous.
    current.target = clamp(current.target + Math.max(-3, Math.min(3, pixels / 110)));
    // Bound the travel left after a long burst so stopping still feels controlled.
    current.target = clamp(Math.max(current.x - 4, Math.min(current.x + 4, current.target)));
    clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => { current.target = Math.round(current.target); }, 130);
    cancelAnimationFrame(frame.current);
    const tick = (now: number) => {
      const dt = Math.min((now - current.time) / 1000, 0.032);
      current.time = now;
      const upper = Math.max(0, latest.current.count - 1);
      current.target = Math.max(0, Math.min(upper, current.target));
      if (reduced.current) { current.x = Math.round(current.target); current.velocity = 0; }
      else {
        // Near-critical damping: weight on pickup, smooth settling without wobble.
        const acceleration = 190 * (current.target - current.x) - 27 * current.velocity;
        current.velocity += acceleration * dt;
        current.x = Math.max(0, Math.min(upper, current.x + current.velocity * dt));
      }
      const settled = Number.isInteger(current.target) && Math.abs(current.target - current.x) < .002 && Math.abs(current.velocity) < .015;
      if (settled) current.x = current.target;
      latest.current.onSelect(Math.round(current.x));
      setPosition(current.x);
      if (settled) { current.running = false; setPosition(null); }
      else frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, []);

  return { position, advance, cancel };
}

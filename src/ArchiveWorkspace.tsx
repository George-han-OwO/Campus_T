import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, Search, X } from "lucide-react";
import "./archive.css";
import { useArchiveMotion } from "./useArchiveMotion";

type Reading = {
  captured_at: string; record_id?: string; co2_ppm: number | null;
  scd_temp_c: number | null; scd_humidity_pct: number | null;
  sht_temp_c: number | null; sht_humidity_pct: number | null; sample_count?: number;
  timestamp_source?: "device" | "received"; received_at?: string;
};
type Page = { ok: boolean; records: Reading[]; totalCount: number; page: { nextCursor: string | null } };
type Props = {
  locationId: string; hours: number; fallbackReadings: Reading[];
  onSetHours: (hours: number) => void; onOpenApi: () => void;
  detectAnomalies: (values: { time: string; value: number }[], metric: "co2_ppm") => { start: number; end: number }[];
};
const keyOf = (record: Reading) => record.record_id ?? record.captured_at;
// A fixed zone makes minute searches independent of the viewer's computer zone.
const minuteOf = (value: string | number) => new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 16).replace("T", " ");
const secondOf = (value: string) => new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ");
const numberText = (value: number | null | undefined, digits = 1) => typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
const mergeRecords = (older: Reading[], newer: Reading[]) => [...new Map([...older, ...newer].map(record => [keyOf(record), record])).values()];

function parseSearch(input: string): { valid: boolean; label: string; matches: (record: Reading) => boolean } {
  const query = input.trim().replace(/[：]/g, ":").replace(/[/.]/g, "-").replace(/T/g, " ").replace(/\s+/g, " ");
  if (!query) return { valid: true, label: "全部时间", matches: () => true };
  const today = minuteOf(Date.now()).slice(0, 10);
  const yesterday = minuteOf(Date.now() - 86400000).slice(0, 10);
  const normalized = query.replace(/^(今天|today)/i, today).replace(/^(昨天|yesterday)/i, yesterday).trim();
  const match = normalized.match(/^(?:(?:(\d{4})-)?(\d{1,2})-(\d{1,2}))?(?:\s*(\d{1,2}):(\d{2}))?$/);
  if (!match || !match.slice(1).some(Boolean)) return { valid: false, label: "输入 20:08、10-14 或 今天 20:08", matches: () => true };
  const [, year, month, day, hour, minute] = match;
  const pad = (part: string) => part.padStart(2, "0");
  const date = month ? `${year ?? today.slice(0, 4)}-${pad(month)}-${pad(day)}` : "";
  const time = hour ? `${pad(hour)}:${minute}` : "";
  if ((date && (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31 || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) || (time && (Number(hour) > 23 || Number(minute) > 59))) {
    return { valid: false, label: "日期或时间无效，请检查输入", matches: () => true };
  }
  return { valid: true, label: [date, time].filter(Boolean).join(" "), matches: record => {
    const value = minuteOf(record.captured_at);
    return (!date || value.startsWith(date)) && (!time || value.slice(11) === time);
  } };
}

export default function ArchiveWorkspace({ locationId, hours, fallbackReadings, onSetHours, onOpenApi, detectAnomalies }: Props) {
  const [records, setRecords] = useState<Reading[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [olderLoading, setOlderLoading] = useState(false);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [departing, setDeparting] = useState<Map<string, number>>(new Map());
  const [arriving, setArriving] = useState<Map<string, number>>(new Map());
  const departureTimer = useRef<number | undefined>(undefined);
  const arrivalTimer = useRef<number | undefined>(undefined);
  const seenRecordKeys = useRef(new Set<string>());
  const viewport = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const paging = useRef(false);
  const pointerY = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current = controller;
    let initialized = false;
    setRecords([]); setCursor(null); setTotal(0); setSelectedKey(null); setLoading(true); setOlderLoading(false); setArriving(new Map()); seenRecordKeys.current.clear(); paging.current = false;
    async function load() {
      try {
        const response = await fetch(`/api/records?location=${encodeURIComponent(locationId)}&limit=500`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) });
        if (!response.ok) throw new Error("Archive unavailable");
        const data = await response.json() as Page;
        if (!data.ok || !Array.isArray(data.records)) throw new Error("Invalid archive response");
        if (controller.signal.aborted) return;
        const added = initialized ? data.records.filter(record => !seenRecordKeys.current.has(keyOf(record))) : [];
        data.records.forEach(record => seenRecordKeys.current.add(keyOf(record)));
        if (added.length) {
          clearTimeout(arrivalTimer.current);
          setArriving(new Map(added.map((record, index) => [keyOf(record), index])));
          arrivalTimer.current = window.setTimeout(() => setArriving(new Map()), 1600);
        }
        setRecords(current => mergeRecords(current, data.records));
        setTotal(data.totalCount);
        // Polling the newest page must not reset the cursor or discard loaded history.
        if (!initialized) { setCursor(data.page.nextCursor); initialized = true; }
        setError(false);
      } catch { if (!controller.signal.aborted) setError(true); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { controller.abort(); clearInterval(timer); clearTimeout(departureTimer.current); clearTimeout(arrivalTimer.current); document.body.style.overflow = previousOverflow; };
  }, [locationId]);

  const fallback = records.length === 0;
  const ordered = useMemo(() => (fallback ? fallbackReadings : records)
    .filter(record => Number.isFinite(Date.parse(record.captured_at)))
    .slice().sort((a, b) => Date.parse(b.captured_at) - Date.parse(a.captured_at)), [records, fallbackReadings, fallback]);
  const search = useMemo(() => parseSearch(query), [query]);
  const filtering = query.trim().length > 0 && search.valid;
  const eligible = useMemo(() => ordered.filter(record => filtering ? search.matches(record) : Date.parse(record.captured_at) >= Date.now() - hours * 3600000), [ordered, filtering, search, hours]);
  const eligibleKeys = useMemo(() => new Set(eligible.map(keyOf)), [eligible]);
  const initialRank = filtering ? 0 : Math.min(4, eligible.length - 1);
  const selected = eligible.find(record => keyOf(record) === selectedKey) ?? eligible[initialRank] ?? null;
  const selectedRank = selected ? eligible.findIndex(record => keyOf(record) === keyOf(selected)) : -1;
  const anchor = selected ? ordered.findIndex(record => keyOf(record) === keyOf(selected)) : 0;
  const motion = useArchiveMotion(selectedRank, eligible.length, index => {
    const record = eligible[index];
    if (record) setSelectedKey(keyOf(record));
  });
  const cancelMotion = motion.cancel;
  const eligibleSignature = eligible.map(keyOf).join("|");
  useEffect(() => { cancelMotion(); }, [query, hours, locationId, eligibleSignature, cancelMotion]);
  useEffect(() => {
    if (selected && selectedKey === null) setSelectedKey(keyOf(selected));
  }, [selected, selectedKey]);
  const anomalies = useMemo(() => {
    const valid = ordered.slice().reverse().filter(record => typeof record.co2_ppm === "number" && Number.isFinite(record.co2_ppm));
    const result = new Set<string>();
    for (const range of detectAnomalies(valid.map(record => ({ time: record.captured_at, value: record.co2_ppm! })), "co2_ppm")) {
      for (let index = range.start; index <= range.end; index++) result.add(keyOf(valid[index]));
    }
    return result;
  }, [ordered, detectAnomalies]);
  const move = useCallback((delta: number) => {
    cancelMotion();
    if (!eligible.length) return;
    setSelectedKey(current => {
      const found = eligible.findIndex(record => keyOf(record) === current);
      const index = found >= 0 ? found : Math.max(0, initialRank);
      return keyOf(eligible[Math.max(0, Math.min(eligible.length - 1, index + delta))]);
    });
  }, [eligible, initialRank, cancelMotion]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      motion.advance(delta);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [motion.advance]);

  async function loadOlder() {
    const controller = requestRef.current;
    if (!cursor || paging.current || !controller) return;
    paging.current = true; setOlderLoading(true);
    try {
      const response = await fetch(`/api/records?location=${encodeURIComponent(locationId)}&limit=500&cursor=${encodeURIComponent(cursor)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) });
      if (!response.ok) throw new Error("Archive unavailable");
      const data = await response.json() as Page;
      if (!data.ok || !Array.isArray(data.records)) throw new Error("Invalid archive response");
      if (controller.signal.aborted) return;
      data.records.forEach(record => seenRecordKeys.current.add(keyOf(record)));
      setRecords(current => mergeRecords(current, data.records)); setCursor(data.page.nextCursor); setTotal(data.totalCount); setError(false);
    } catch { if (!controller.signal.aborted) setError(true); }
    finally { if (!controller.signal.aborted) { setOlderLoading(false); paging.current = false; } }
  }
  // Keep nearby rejected planes in the scene and collapse the matching sequence.
  const visible = new Set(ordered.slice(Math.max(0, anchor - 13), anchor + 14).map(keyOf));
  eligible.slice(Math.max(0, selectedRank - 10), Math.max(0, selectedRank) + 11).forEach(record => visible.add(keyOf(record)));
  const updateQuery = (value: string) => {
    cancelMotion();
    // Keep the outgoing window mounted until its retreat completes, even if the
    // search jumps to a distant date. Stable record keys preserve the transition.
    setDeparting(new Map(ordered.filter(record => visible.has(keyOf(record))).map(record => {
      const rank = eligible.findIndex(item => keyOf(item) === keyOf(record));
      return [keyOf(record), rank < 0 ? (ordered.indexOf(record) - anchor) * .76 : rank - Math.max(0, selectedRank)];
    })));
    clearTimeout(departureTimer.current);
    departureTimer.current = window.setTimeout(() => setDeparting(new Map()), 800);
    setQuery(value); setSelectedKey(null);
  };
  const selectedTime = selected ? minuteOf(selected.captured_at) : "";
  const selectedAnomaly = selected ? anomalies.has(keyOf(selected)) : false;

  return <div className="archive-workspace">
    <section className="archive-scene" aria-label="环境记录时间层">
      <div className="archive-scene-top"><span><b className="archive-id-tag">DB / 01</b> FIELD ARCHIVE / {locationId}</span><span>{arriving.size > 0 && <b className="archive-new-record-badge" role="status">+{arriving.size} 新记录</b>}{String(ordered.length).padStart(3, "0")} <small>LAYERS</small></span></div>
      <div ref={viewport} className={`archive-viewport ${motion.position !== null ? "is-gliding" : ""}`} tabIndex={0} role="region" aria-label="时间层选择器，向下滚动查看更早记录，也可使用上下方向键" onKeyDown={event => {
        if (["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(event.key)) {
          event.preventDefault();
          cancelMotion();
          if (event.key === "Home") setSelectedKey(eligible[0] ? keyOf(eligible[0]) : null);
          else if (event.key === "End") setSelectedKey(eligible.at(-1) ? keyOf(eligible.at(-1)!) : null);
          else move(event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : event.key === "PageDown" ? 5 : -5);
        }
      }} onPointerDown={event => { if (event.pointerType !== "mouse") { pointerY.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); } }} onPointerMove={event => {
        if (pointerY.current !== null) { motion.advance((pointerY.current - event.clientY) * 2); pointerY.current = event.clientY; }
      }} onPointerUp={() => { pointerY.current = null; }} onPointerCancel={() => { pointerY.current = null; }}>
        <div className="archive-rail left" /><div className="archive-rail right" />
        <div className="archive-reticle" aria-hidden="true" /><div className="archive-ruler" aria-hidden="true">{Array.from({ length: 11 }, (_, index) => <span key={index}>{String(index * 10).padStart(3, "0")}</span>)}</div>
        <div className="archive-planes">
          {ordered.filter(record => visible.has(keyOf(record)) || departing.has(keyOf(record))).map(record => {
            const key = keyOf(record);
            const index = ordered.indexOf(record);
            const rejected = !eligibleKeys.has(key);
            const rank = eligible.findIndex(item => keyOf(item) === key);
            const offset = rejected ? departing.get(key) ?? (index - anchor) * 0.76 : rank - (motion.position ?? Math.max(0, selectedRank));
            const active = selected !== null && key === keyOf(selected);
            return <button key={key} className={`archive-plane ${active ? "is-current" : ""} ${anomalies.has(key) ? "is-anomaly" : ""} ${rejected ? "is-receded" : ""} ${arriving.has(key) ? "is-new" : ""}`} style={{ "--offset": offset, zIndex: active ? 80 : rejected ? 1 : 40 - Math.min(Math.abs(offset), 30) } as CSSProperties} type="button" disabled={rejected} tabIndex={-1} onClick={() => { cancelMotion(); setSelectedKey(key); }} aria-label={`${minuteOf(record.captured_at)}${anomalies.has(key) ? "，疑似异常波动" : ""}`} aria-pressed={active}>
              <svg viewBox="0 0 460 142" preserveAspectRatio="none" aria-hidden="true"><g className="plane-drawing" style={{ animationDelay: `${((arriving.get(key) ?? 0) % 6) * 70}ms` }}><polygon className="plane-hit" points="4,138 154,4 456,4 306,138" /><polygon className="plane-outline" points="4,138 154,4 456,4 306,138" /></g></svg>
            </button>;
          })}
        </div>
        <div className="archive-selector left" aria-hidden="true" /><div className="archive-selector right" aria-hidden="true" />
        <div className="archive-selection-label" aria-live="polite"><span>{selectedTime.slice(0, 10) || "—"}</span><strong>{selectedTime.slice(11) || "— : —"}</strong><small>{selected?.timestamp_source === "received" ? "接收时间 · 采集未校时" : selected ? "当前选择" : filtering ? "没有匹配" : "等待数据"}</small></div>
        <button type="button" className="archive-now" onClick={() => { updateQuery(""); setSelectedKey(ordered[0] ? keyOf(ordered[0]) : null); }}><i />NOW <ArrowUpRight size={13} /></button>
        {!ordered.length && <div className="archive-empty">{loading ? "正在读取观测记录…" : "等待观测数据"}</div>}
      </div>
      <div className="archive-scene-bottom"><span><i className="archive-mechanical-mark" />滚轮 / ↑ ↓ 选择时间层</span><span>INDEX {selectedRank >= 0 ? String(selectedRank + 1).padStart(3, "0") : "000"} / {eligible.length.toLocaleString()}</span></div>
    </section>

    <aside className="archive-inspector">
      <div className="archive-search-section">
        <div className="archive-section-label">01 / FIND A MOMENT</div>
        <h2>找到那一分钟。</h2>
        <label className="archive-search-field"><Search size={18} /><input type="search" value={query} onChange={event => updateQuery(event.target.value)} placeholder="今天 20:08" aria-label="搜索日期或时间，精确到分钟" aria-describedby="archive-search-help" autoComplete="off" spellCheck={false} />{query && <button type="button" aria-label="清除时间筛选" onClick={() => updateQuery("")}><X size={16} /></button>}</label>
        <p id="archive-search-help" className="archive-search-help">{!search.valid ? search.label : filtering ? `${search.label} · ${eligible.length} 条匹配` : "直接输入 20:08、10-14 或 10-14 20:08"}</p>
        <div className="archive-quick-filters">{["今天", "昨天"].map(label => <button type="button" key={label} className={query === label ? "active" : ""} onClick={() => updateQuery(label)}>{label}</button>)}<button type="button" onClick={() => { updateQuery(""); onSetHours(168); }} className={!query && hours === 168 ? "active" : ""}>近 7 天</button><button type="button" onClick={() => { updateQuery(""); onSetHours(24); }}>重置</button></div>
      </div>
      <div className="archive-record-section">
        <div className="archive-section-label">02 / SELECTED RECORD <span>{locationId}</span></div>
        <div className="archive-selected-heading"><time dateTime={selected?.captured_at}>{selected ? secondOf(selected.captured_at) : "暂无匹配记录"}</time><span>{selected?.timestamp_source === "received" ? "接收时间" : "采集时间"} · UTC+8</span></div>
        <div className="archive-values">
          <div className="archive-co2"><span>二氧化碳</span><strong>{numberText(selected?.co2_ppm, 0)}<small>ppm</small></strong></div>
          <div><span>温度</span><strong>{numberText(selected?.sht_temp_c ?? selected?.scd_temp_c)}<small>°C</small></strong></div>
          <div><span>相对湿度</span><strong>{numberText(selected?.sht_humidity_pct ?? selected?.scd_humidity_pct)}<small>%</small></strong></div>
        </div>
        <div className={`archive-record-state ${selectedAnomaly ? "warning" : ""}`}>{selectedAnomaly ? "疑似异常波动 · 建议复核 CO₂ 记录" : selected ? `${selected.record_id ? "原始观测" : "趋势均值"} · ${selected.sample_count ?? 1} 个样本` : filtering ? "已载入数据中没有匹配；可修改时间或加载更早记录。" : "该时段暂时没有观测数据。"}</div>
        {selected?.timestamp_source === "received" ? <p className="archive-timestamp-note">设备采样时尚未校时，采集时间未知；上方显示服务器接收时间。</p> : selected?.received_at && Number.isFinite(Date.parse(selected.received_at)) ? <p className="archive-timestamp-note">服务器接收于 {secondOf(selected.received_at)}（UTC+8）</p> : null}
        <div className="archive-navigation"><button type="button" onClick={() => move(-1)} disabled={selectedRank <= 0}><ArrowUp size={15} />更新</button><button type="button" onClick={() => move(1)} disabled={selectedRank < 0 || selectedRank >= eligible.length - 1}><ArrowDown size={15} />更早</button></div>
      </div>
      <div className="archive-inspector-bottom">
        <div className="archive-legend"><span><i className="current" />当前</span><span><i className="anomaly" />异常</span><span><i />观测</span></div>
        <p>{fallback ? "当前使用趋势数据，原始记录接口暂不可用。" : `已载入 ${ordered.length.toLocaleString()} / ${total.toLocaleString()} 条原始记录。`}{" "}搜索仅覆盖已载入数据。</p>
        {error && !fallback && <p role="status">记录刷新失败，已保留载入的数据，请稍后重试。</p>}
        <div className="archive-data-actions">{cursor && <button type="button" onClick={() => void loadOlder()} disabled={olderLoading}>{olderLoading ? "正在载入…" : "加载更早记录"}</button>}<button type="button" disabled={fallback} onClick={onOpenApi}>数据接口 <ArrowUpRight size={13} /></button></div>
      </div>
    </aside>
  </div>;
}

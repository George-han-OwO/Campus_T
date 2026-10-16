"use client";
import ArchiveWorkspace from "./ArchiveWorkspace";
import DeviceStatus, { useDeviceStatus } from "./DeviceStatus";
import ArchiveBackdrop from "./ArchiveBackdrop";
import ArchiveDataFlow from "./ArchiveDataFlow";
import { chartTimeLabel, chartTimeScale } from "./chartTimeScale";
import { locationLabel } from "./locations";

import {
  Activity,
  AirVent,
  Check,
  ChevronDown,
  CircleHelp,
  Cloud,
  Database,
  Download,
  Droplets,
  Leaf,
  MapPin,
  Plus,
  RefreshCw,
  Trash2,
  Thermometer,
  Wifi,
  WifiOff,
  Wind,
} from "lucide-react";
import { type FormEvent, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

const CampusMap = lazy(() => import("./CampusMap"));

type Reading = {
  captured_at: string;
  record_id?: string;
  co2_ppm: number | null;
  scd_temp_c: number | null;
  scd_humidity_pct: number | null;
  sht_temp_c: number | null;
  sht_humidity_pct: number | null;
  sample_count?: number;
  timestamp_source?: "device" | "received";
  received_at?: string;
};

type Latest = Reading & {
  record_id: string;
  device_id: string;
  location_id: string;
  timestamp_source: "device" | "received";
  received_at: string;
};

type ApiPayload = {
  ok: boolean;
  latest: Latest | null;
  readings: Reading[];
  sampleCount: number;
  serverTime: string;
};


type MetricKey = "co2_ppm" | "sht_temp_c" | "sht_humidity_pct";
type ViewKey = "overview" | "database" | "plants" | "map";
type PlotEntry = { id: string; point: string; date: string; species: number; coverage: number; note: string };

function temperatureValue(reading: Reading | null | undefined) {
  return reading?.sht_temp_c ?? reading?.scd_temp_c ?? null;
}

function humidityValue(reading: Reading | null | undefined) {
  return reading?.sht_humidity_pct ?? reading?.scd_humidity_pct ?? null;
}

function metricValue(reading: Reading, metric: MetricKey) {
  if (metric === "sht_temp_c") return temperatureValue(reading);
  if (metric === "sht_humidity_pct") return humidityValue(reading);
  return reading.co2_ppm;
}

const timeframes = [
  { label: "1 小时", hours: 1 },
  { label: "6 小时", hours: 6 },
  { label: "24 小时", hours: 24 },
  { label: "7 天", hours: 168 },
];

const metricMeta: Record<MetricKey, { title: string; unit: string; color: string; icon: typeof Wind; decimals: number }> = {
  co2_ppm: { title: "二氧化碳", unit: "ppm", color: "#ededed", icon: Wind, decimals: 0 },
  sht_temp_c: { title: "室内温度", unit: "°C", color: "#bcbcbc", icon: Thermometer, decimals: 1 },
  sht_humidity_pct: { title: "相对湿度", unit: "%", color: "#999999", icon: Droplets, decimals: 1 },
};

const anomalyFloor: Record<MetricKey, number> = {
  co2_ppm: 180,
  sht_temp_c: 1.2,
  sht_humidity_pct: 6,
};

function valueText(value: number | null | undefined, digits = 1) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function formatTime(value: string | null | undefined) {
  if (!value) return "等待设备数据";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间待同步";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}


function median(numbers: number[]) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function findAnomalies(values: { time: string; value: number }[], metric: MetricKey) {
  if (values.length < 5) return [] as { start: number; end: number }[];
  const flagged: number[] = [];
  const radius = 3;

  values.forEach((item, index) => {
    const neighbors = values
      .slice(Math.max(0, index - radius), Math.min(values.length, index + radius + 1))
      .filter((_, neighborIndex) => Math.max(0, index - radius) + neighborIndex !== index)
      .map((neighbor) => neighbor.value);
    if (neighbors.length < 4) return;
    const baseline = median(neighbors);
    const mad = median(neighbors.map((value) => Math.abs(value - baseline)));
    const deviation = Math.abs(item.value - baseline);
    const threshold = Math.max(anomalyFloor[metric], mad * 1.4826 * 3.5);
    if (deviation > threshold) flagged.push(index);
  });

  const regions: { start: number; end: number }[] = [];
  for (const index of flagged) {
    const previous = regions.at(-1);
    if (previous && index <= previous.end + 1) previous.end = index;
    else regions.push({ start: index, end: index });
  }
  return regions;
}

function PlantWorkspace() {
  const [entries, setEntries] = useState<PlotEntry[]>(() => {
    try {
      const saved = window.localStorage.getItem("campus-atlas-plant-plots-v1");
      if (!saved) return [];
      const parsed: unknown = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed as PlotEntry[] : [];
    } catch {
      return [];
    }
  });
  const [point, setPoint] = useState("A");
  const [species, setSpecies] = useState("");
  const [coverage, setCoverage] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    try { window.localStorage.setItem("campus-atlas-plant-plots-v1", JSON.stringify(entries)); } catch { /* local storage may be disabled */ }
  }, [entries]);

  const saveEntry = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const speciesCount = Number(species);
    const coveragePercent = Number(coverage);
    if (!Number.isFinite(speciesCount) || !Number.isFinite(coveragePercent)) return;
    setEntries((current) => [{
      id: crypto.randomUUID(), point, date: new Date().toISOString().slice(0, 10),
      species: speciesCount, coverage: coveragePercent, note: note.trim(),
    }, ...current]);
    setSpecies(""); setCoverage(""); setNote("");
  };

  const removeEntry = (id: string) => setEntries((current) => current.filter((entry) => entry.id !== id));

  return (
    <div className="workspace-grid plants-workspace">
      <section className="glass-panel workspace-card">
        <div className="section-heading compact-heading"><div><div className="section-kicker">FIELD OBSERVATION</div><h2>记录植物样方</h2></div><span className="record-badge">莲花馆外 · A/B/C</span></div>
        <p className="workspace-intro">每次记录一个 1m × 1m 样方。记录保存在当前浏览器，便于现场采集和后续导出核对。</p>
        <form className="plant-form" onSubmit={saveEntry}>
          <label>样方点位<select value={point} onChange={(event) => setPoint(event.target.value)}><option value="A">A · 北侧草地</option><option value="B">B · 中部花坛</option><option value="C">C · 南侧树荫</option></select></label>
          <label>植物物种数<input type="number" min="0" max="200" step="1" value={species} onChange={(event) => setSpecies(event.target.value)} required placeholder="例如 6" /></label>
          <label>植被覆盖率（%）<input type="number" min="0" max="100" step="0.1" value={coverage} onChange={(event) => setCoverage(event.target.value)} required placeholder="例如 72" /></label>
          <label className="plant-note-field">观察备注<input value={note} onChange={(event) => setNote(event.target.value)} maxLength={160} placeholder="可记录修剪、施工或天气情况" /></label>
          <button className="primary-action" type="submit"><Plus size={14} />保存本次记录</button>
        </form>
      </section>
      <section className="glass-panel workspace-card plant-records-card">
        <div className="section-heading compact-heading"><div><div className="section-kicker">LOCAL LOG</div><h2>样方记录</h2></div><span className="record-badge">{entries.length} 条</span></div>
        {entries.length ? <div className="plant-log-list">{entries.map((entry) => <article className="plant-log-row" key={entry.id}><div className="plant-log-point">{entry.point}</div><div className="plant-log-main"><strong>{entry.species} 种植物 · 覆盖率 {entry.coverage}%</strong><span>{entry.date}{entry.note ? ` · ${entry.note}` : ""}</span></div><button className="quiet-icon-button" type="button" aria-label={`删除 ${entry.point} 样方记录`} onClick={() => removeEntry(entry.id)}><Trash2 size={14} /></button></article>)}</div> : <div className="workspace-empty"><Leaf size={18} /><strong>还没有样方记录</strong><span>填写左侧表单即可开始记录；数据会保存在这台设备的浏览器中。</span></div>}
      </section>
    </div>
  );
}

function SensorChart({ readings, metric, rangeStart, rangeEnd, loading, failed, height = 390 }: { readings: Reading[]; metric: MetricKey; rangeStart: number; rangeEnd: number; loading: boolean; failed: boolean; height?: number }) {
  const meta = metricMeta[metric];
  const values = readings
    .map((reading) => ({
      time: reading.captured_at,
      value: metricValue(reading, metric),
    }))
    .filter((item): item is { time: string; value: number } => typeof item.value === "number" && Number.isFinite(item.value) && Number.isFinite(Date.parse(item.time)))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const timeScale = chartTimeScale(values.map(item => Date.parse(item.time)), rangeStart, rangeEnd);
  const anomalyRegions = findAnomalies(values, metric);
  const anomalyPointCount = anomalyRegions.reduce((count, region) => count + region.end - region.start + 1, 0);
  const width = 900;
  const margin = { top: 20, right: 20, bottom: 28, left: 20 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const domain = values.length ? values.map((item) => item.value) : [0, 1];
  const min = Math.min(...domain);
  const max = Math.max(...domain);
  const padding = max === min ? Math.max(Math.abs(max) * 0.08, 1) : (max - min) * 0.15;
  const lower = min - padding;
  const upper = max + padding;
  const points = values.map((item) => ({
    x: margin.left + Math.max(0, Math.min(1, (Date.parse(item.time) - timeScale.start) / (timeScale.end - timeScale.start))) * chartWidth,
    y: margin.top + chartHeight - ((item.value - lower) / (upper - lower)) * chartHeight,
  }));
  const regionRects = anomalyRegions.map((region) => {
    const left = region.start === 0 ? Math.max(margin.left, points[region.start].x - 3) : (points[region.start - 1].x + points[region.start].x) / 2;
    const right = region.end === points.length - 1 ? Math.min(width - margin.right, points[region.end].x + 3) : (points[region.end].x + points[region.end + 1].x) / 2;
    return { ...region, x: left, width: Math.max(right - left, 4) };
  });
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
  const areaPath = points.length
    ? `${linePath} L${points.at(-1)!.x},${margin.top + chartHeight} L${points[0].x},${margin.top + chartHeight} Z`
    : "";

  return (
    <div className="chart-wrap" aria-busy={loading}>
      {timeScale.zoomed && <div className="chart-domain-note">时间轴已自动细化 · {chartTimeLabel(timeScale.start, timeScale.seconds, true)} – {chartTimeLabel(timeScale.end, timeScale.seconds, true)}（UTC+8）</div>}
      <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${meta.title}变化趋势图`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`chart-fill-${metric}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={meta.color} stopOpacity="0.13" />
            <stop offset="100%" stopColor={meta.color} stopOpacity="0.005" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((line) => {
          const y = margin.top + (chartHeight / 3) * line;
          return <line key={line} x1={margin.left} x2={width - margin.right} y1={y} y2={y} className="chart-gridline" />;
        })}
        {regionRects.map((region, index) => (
          <rect key={`anomaly-${index}`} x={region.x} y={margin.top} width={region.width} height={chartHeight} rx="3" className="chart-anomaly-region">
            <title>{`${formatTime(values[region.start].time)}–${formatTime(values[region.end].time)}：${meta.title}出现偏离邻近读数的波动`}</title>
          </rect>
        ))}
        {areaPath ? <path d={areaPath} fill={`url(#chart-fill-${metric})`} /> : null}
        {linePath ? <path d={linePath} fill="none" stroke={meta.color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /> : null}
        {anomalyRegions.flatMap((region) => Array.from({ length: region.end - region.start + 1 }, (_, offset) => {
          const pointIndex = region.start + offset;
          const point = points[pointIndex];
          return <circle key={`anomaly-point-${pointIndex}`} cx={point.x} cy={point.y} r="4.2" className="chart-anomaly-point" vectorEffect="non-scaling-stroke"><title>{`${formatTime(values[pointIndex].time)} · ${valueText(values[pointIndex].value, meta.decimals)} ${meta.unit}`}</title></circle>;
        }))}
        {points.length > 0 ? <circle cx={points.at(-1)!.x} cy={points.at(-1)!.y} r="4" fill={anomalyRegions.some((region) => points.length - 1 >= region.start && points.length - 1 <= region.end) ? "#d94d49" : meta.color} stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" /> : null}
        {points.map((point, index) => <circle key={`sample-${index}`} cx={point.x} cy={point.y} r={points.length <= 20 ? 3 : 7} fill={points.length <= 20 ? meta.color : "transparent"} stroke="none"><title>{`${chartTimeLabel(Date.parse(values[index].time), true, true)} UTC+8 · ${valueText(values[index].value, meta.decimals)} ${meta.unit}`}</title></circle>)}
      </svg>
      <div className="chart-axis-labels adaptive-axis">{timeScale.ticks.map(time => <span key={time} style={{ left: `${(margin.left + (time - timeScale.start) / (timeScale.end - timeScale.start) * chartWidth) / width * 100}%` }}>{chartTimeLabel(time, timeScale.seconds, timeScale.end - timeScale.start >= 86400000)}</span>)}</div>
      {values.length ? (
        <>
          <div className={`anomaly-summary ${anomalyRegions.length ? "has-anomalies" : ""}`} title="用当前图表中相邻最多 6 个时间段的中位数和 MAD 估算局部基线。标记用于提醒复核，不代表传感器故障或空气质量安全结论。">
            <span className="anomaly-legend-dot" />
            {anomalyRegions.length ? `筛查到 ${anomalyRegions.length} 段异常波动 · ${anomalyPointCount} 个时段` : "未发现明显异常波动"}
            <span className="anomaly-method">基于邻近读数偏离筛查</span>
          </div>
        </>
      ) : (
        <div className="chart-empty">
          <span className="empty-orbit"><Activity size={19} strokeWidth={1.5} /></span>
          <strong>{loading ? "正在读取所选时段…" : failed ? "这个时段的数据暂时无法读取" : "所选时段暂无有效读数"}</strong>
          <span>{failed ? "请稍后重试，或选择其他时间范围。" : "可以切换到更长时段查看历史记录；空白时间段表示没有观测数据。"}</span>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [hours, setHours] = useState(24);
  const [metric, setMetric] = useState<MetricKey>("co2_ppm");
  const [location, setLocation] = useState("M1");
  const [activeView, setActiveView] = useState<ViewKey>(() => window.location.hash === "#map" ? "map" : window.location.hash === "#database" ? "database" : "overview");
  const [showLocationMenu, setShowLocationMenu] = useState(false);
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [payloadLocation, setPayloadLocation] = useState("");
  const [payloadHours, setPayloadHours] = useState(24);
  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const readingsCache = useRef(new Map<string, ApiPayload>());
  const currentScope = useRef("");
  currentScope.current = `${location}:${hours}`;
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [showDeviceGuide, setShowDeviceGuide] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => {
    let frame = 0;
    const tick = () => { setClockNow(Date.now()); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const refresh = useCallback(async (force = false) => {
    if (!force && requestController.current && !requestController.current.signal.aborted) return;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const sequence = ++requestSequence.current;
    const scope = `${location}:${hours}`;
    const cached = readingsCache.current.get(scope);
    if (cached) { setPayload(cached); setPayloadLocation(location); setPayloadHours(hours); }
    setLoading(true);
    try {
      const response = await fetch(`/api/readings?location=${encodeURIComponent(location)}&hours=${hours}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as ApiPayload;
      if (!data.ok || !Array.isArray(data.readings)) throw new Error("Invalid readings response");
      if (controller.signal.aborted || sequence !== requestSequence.current || currentScope.current !== scope) return;
      readingsCache.current.set(scope, data);
      setPayload(data);
      setPayloadLocation(location);
      setPayloadHours(hours);
      setFetchError(false);
      setLastRefresh(new Date());
    } catch {
      if (!controller.signal.aborted && sequence === requestSequence.current && currentScope.current === scope) setFetchError(true);
    } finally {
      if (!controller.signal.aborted && sequence === requestSequence.current && currentScope.current === scope) { setLoading(false); requestController.current = null; }
    }
  }, [hours, location]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15_000);
    return () => { window.clearInterval(interval); requestController.current?.abort(); };
  }, [refresh]);

  const deviceStatus = useDeviceStatus();
  const onlineDevices = deviceStatus.devices.filter(device => device.handshake === "online");
  const latest = payloadLocation === location ? payload?.latest ?? null : null;
  const isOnline = onlineDevices.some(device => device.location_id === location);
  const activeMetric = metricMeta[metric];
  const rangeEnd = useMemo(() => {
    const time = payload ? Date.parse(payload.serverTime) : Date.now();
    return Number.isFinite(time) ? time : Date.now();
  }, [payload, hours]);
  const rangeStart = rangeEnd - hours * 3600000;
  const selectedReadings = useMemo(() => payloadLocation !== location ? [] : (payload?.readings ?? [])
    .filter(reading => { const time = Date.parse(reading.captured_at); return time >= rangeStart && time <= rangeEnd; })
    .slice().sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at)), [payload, payloadLocation, location, rangeStart, rangeEnd]);
  const selectedSampleCount = selectedReadings.reduce((sum, reading) => sum + (reading.sample_count ?? 1), 0);
  const recentReadings = [...selectedReadings].slice(-6).reverse();
  const locationOptions = [
    { id: "M1", label: locationLabel("M1"), kind: "环境传感器点位 · 数据编号 M1" },
    { id: "A", label: "样方 A · 北侧草地", kind: "待调查点位" },
    { id: "B", label: "样方 B · 中部花坛", kind: "待调查点位" },
    { id: "C", label: "样方 C · 南侧树荫", kind: "待调查点位" },
    ...Array.from(new Set(deviceStatus.devices.map(device => device.location_id)))
      .filter(id => !["M1", "A", "B", "C"].includes(id))
      .map(id => ({ id, label: `设备点位 · ${id}`, kind: "已识别设备点位" })),
  ];
  const selectedLocation = locationOptions.find((item) => item.id === location) ?? locationOptions[0];
  const periodMeans = useMemo(() => {
    const mean = (pick: (reading: Reading) => number | null) => {
      let weightedTotal = 0;
      let totalWeight = 0;
      for (const reading of selectedReadings) {
        const value = pick(reading);
        if (value == null || !Number.isFinite(value)) continue;
        const weight = reading.sample_count ?? 1;
        weightedTotal += value * weight;
        totalWeight += weight;
      }
      return totalWeight ? weightedTotal / totalWeight : null;
    };
    return {
      co2: mean((reading) => reading.co2_ppm),
      temperature: mean(temperatureValue),
      humidity: mean(humidityValue),
    };
  }, [selectedReadings]);

  const clockDate = new Date(clockNow);
  const clockText = `${String(clockDate.getHours()).padStart(2, "0")}:${String(clockDate.getMinutes()).padStart(2, "0")}:${String(clockDate.getSeconds()).padStart(2, "0")}.${String(clockDate.getMilliseconds()).padStart(3, "0")}`;

  return (
    <main className={`atlas-shell ${activeView === "database" ? "archive-view" : activeView === "overview" ? "overview-view" : ""}`}>
      {activeView === "database" && <ArchiveBackdrop />}
      <aside className="side-rail">
        <div className="brand-lockup">
          <div className="brand-mark"><span /><span /><span /><span /></div>
          <div><strong>校园观测</strong><small>FIELD ATLAS</small></div>
        </div>

        <div className="rail-section-label">工作区</div>
        <nav className="rail-nav" aria-label="主导航">
          <button className={`rail-link ${activeView === "overview" ? "active" : ""}`} type="button" onClick={() => setActiveView("overview")}><Activity size={17} /><span>环境概览</span>{activeView === "overview" ? <span className="rail-indicator" /> : null}</button>
          <button className={`rail-link ${activeView === "database" ? "active" : ""}`} type="button" onClick={() => setActiveView("database")}><Database size={17} /><span>数据档案</span>{activeView === "database" ? <span className="rail-indicator" /> : null}</button>
          <button className={`rail-link ${activeView === "plants" ? "active" : ""}`} type="button" onClick={() => setActiveView("plants")}><Leaf size={17} /><span>植物样方</span>{activeView === "plants" ? <span className="rail-indicator" /> : null}</button>
          <button className={`rail-link ${activeView === "map" ? "active" : ""}`} type="button" onClick={() => setActiveView("map")}><MapPin size={17} /><span>点位地图</span>{activeView === "map" ? <span className="rail-indicator" /> : null}</button>
        </nav>

        <div className="rail-separator" />
        <div className="rail-section-label">本期节点</div>
        {deviceStatus.devices.length ? deviceStatus.devices.map(device => <button key={device.device_id} className={`node-select ${location === device.location_id ? "active" : ""}`} type="button" onClick={() => { setLocation(device.location_id); setActiveView("overview"); }}>
          <span className="node-glyph"><AirVent size={15} /></span>
          <span className="node-name"><strong>{device.device_id}</strong><small>{locationLabel(device.location_id)} · {device.handshake === "online" ? "握手在线" : device.handshake === "expired" ? "握手超时" : device.handshake === "unknown" ? "待设备握手" : "状态未知"}</small></span>
          <span className={`tiny-status ${device.handshake === "online" ? "online" : ""}`} />
        </button>) : <button className={`node-select ${location === "M1" ? "active" : ""}`} type="button" onClick={() => { setLocation("M1"); setActiveView("overview"); }}>
          <span className="node-glyph"><AirVent size={15} /></span>
          <span className="node-name"><strong>M104 教室</strong><small>ESP32-S3 节点 01</small></span>
          <span className={`tiny-status ${isOnline ? "online" : ""}`} />
        </button>}

        <div className="rail-action-list">
          <a href={`/api/records?location=${encodeURIComponent(location)}&limit=500`} target="_blank" rel="noreferrer" className="rail-action"><Download size={15} /><span>数据导出接口</span></a>
          <button className="rail-action" type="button" onClick={() => setShowDeviceGuide(true)}><Plus size={15} /><span>添加设备</span></button>
        </div>

        <div className="rail-spacer" />
        <div className="rail-card">
          <div className="rail-card-orbit"><Cloud size={18} strokeWidth={1.4} /></div>
          <strong>校园环境档案</strong>
          <p>让可见的数据，成为下一步改善的依据。</p>
          <span>2026 · CYCLE 01</span>
        </div>
        <div className="rail-footer"><span className="footer-avatar">MS</span><span><strong>测量与记录</strong><small>公开展示模式</small></span><ChevronDown size={14} /></div>
      </aside>

      <section className="main-column" id="overview">
        <header className="top-bar glass-topbar">
          <div className="breadcrumb"><span>校园环境</span><span className="breadcrumb-slash">/</span><strong>{activeView === "overview" ? "环境概览" : activeView === "database" ? "数据档案" : activeView === "plants" ? "植物样方" : "点位地图"}</strong></div>
          <div className="top-actions">
            <span className="update-hint"><span className="pulse-dot" />每 15 秒更新</span>
            <button className={`connection-pill ${isOnline ? "connected" : ""}`} type="button" title="点击刷新当前点位握手状态和数据" onClick={() => { void refresh(true); void deviceStatus.refresh(); }}>
              {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span>{deviceStatus.unavailable ? "状态未知" : isOnline ? "握手在线" : "未确认握手"}</span>
            </button>
            <button className="icon-button" type="button" aria-label="立即刷新" onClick={() => void refresh(true)}><RefreshCw size={15} className={loading ? "spin" : ""} /></button>
          </div>
        </header>

        {activeView === "database" && <ArchiveDataFlow />}

        <nav className="mobile-nav" aria-label="移动端导航">
          <button type="button" className={activeView === "overview" ? "active" : ""} onClick={() => setActiveView("overview")}><Activity size={16} /><span>概览</span></button>
          <button type="button" className={activeView === "database" ? "active" : ""} onClick={() => setActiveView("database")}><Database size={16} /><span>档案</span></button>
          <button type="button" className={activeView === "plants" ? "active" : ""} onClick={() => setActiveView("plants")}><Leaf size={16} /><span>样方</span></button>
          <button type="button" className={activeView === "map" ? "active" : ""} onClick={() => setActiveView("map")}><MapPin size={16} /><span>地图</span></button>
          <a href={`/api/records?location=${encodeURIComponent(location)}&limit=500`} target="_blank" rel="noreferrer"><Download size={16} /><span>导出</span></a>
          <button type="button" onClick={() => setShowDeviceGuide(true)}><Plus size={16} /><span>添加</span></button>
        </nav>

        <div className="page-content">
          <div className="page-heading-row">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" />{activeView === "overview" ? "LIVE ENVIRONMENT" : activeView === "database" ? "CHRONOLOGICAL ARCHIVE" : activeView === "plants" ? "FIELD OBSERVATION" : "CAMPUS POINTS"}</div>
              <h1>{activeView === "overview" ? "校园环境概览" : activeView === "database" ? "校园数据档案" : activeView === "plants" ? "植物样方记录" : "校园点位地图"}</h1>
              <p>{activeView === "overview" ? "从一个房间开始，建立可持续复测的环境档案。" : activeView === "database" ? "每一层都是一段真实观测；沿时间切片回看校园环境。" : activeView === "plants" ? "记录莲花馆外候选样方的植物物种与覆盖率。" : "查看已接入设备与待调查样方候选点。"}</p>
              {activeView === "overview" ? <div className="overview-clock"><span>{clockText.slice(0, 8)}</span><i>{clockText.slice(8)}</i></div> : null}
            </div>
            {activeView === "overview" ? <div className="location-picker-wrap">
              <button className="location-button" type="button" aria-expanded={showLocationMenu} onClick={() => setShowLocationMenu((open) => !open)}>
                <MapPin size={15} /><span>{selectedLocation.label}</span><ChevronDown size={14} />
              </button>
              {showLocationMenu ? <div className="location-menu">{locationOptions.map((option) => <button type="button" key={option.id} className={location === option.id ? "selected" : ""} onClick={() => { setLocation(option.id); setShowLocationMenu(false); }}><span><strong>{option.label}</strong><small>{option.kind}</small></span>{location === option.id ? <Check size={14} /> : null}</button>)}</div> : null}
            </div> : null}
          </div>
          {activeView === "overview" ? <>
          <div className="overview-strip">
            <section className="glass-panel overview-tile online-tile">
              <span className="overview-label">握手在线设备</span>
              <strong>{deviceStatus.unavailable ? "—" : String(onlineDevices.length).padStart(2, "0")}<small> / {String(deviceStatus.devices.length).padStart(2, "0")}</small></strong>
              <span className="overview-caption"><span className={`status-dot ${isOnline ? "online-dot" : ""}`} />{deviceStatus.unavailable ? "正在获取握手状态" : "按设备独立确认连接"}</span>
            </section>
            <section className="glass-panel overview-tile average-tile">
              <div className="overview-title-line"><span className="overview-label">当前点位时段均值</span><span className="overview-caption">{selectedLocation.id} · 最近 {timeframes.find((frame) => frame.hours === hours)?.label ?? `${hours} 小时`}</span></div>
              <div className="average-values">
                <div><strong>{valueText(periodMeans.temperature, 1)}<small>°C</small></strong><span>温度</span></div>
                <div><strong>{valueText(periodMeans.humidity, 1)}<small>%</small></strong><span>湿度</span></div>
                <div><strong>{valueText(periodMeans.co2, 0)}<small>ppm</small></strong><span>CO₂</span></div>
              </div>
            </section>
            <section className="glass-panel overview-tile interval-tile">
              <span className="overview-label">当前采样频率</span>
              <strong>1<small> 次 / 分钟</small></strong>
              <span className="overview-caption">固件设定 · 每 60 秒采样</span>
            </section>
          </div>

          <section className="glass-panel chart-panel">
            <div className="section-heading chart-heading">
              <div><div className="section-kicker">HISTORY</div><h2>环境变化</h2></div>
              <div className="chart-controls">
                <div className="segmented metric-toggle" role="tablist" aria-label="选择趋势指标">
                  {(Object.keys(metricMeta) as MetricKey[]).map((key) => {
                    const ItemIcon = metricMeta[key].icon;
                    return <button key={key} type="button" role="tab" aria-selected={metric === key} className={metric === key ? "selected" : ""} onClick={() => setMetric(key)}><ItemIcon size={14} /><span>{metricMeta[key].title}</span></button>;
                  })}
                </div>
                <div className="segmented range-toggle" role="tablist" aria-label="选择时间范围">
                  {timeframes.map((frame) => <button key={frame.hours} type="button" role="tab" aria-selected={hours === frame.hours} className={hours === frame.hours ? "selected" : ""} onClick={() => setHours(frame.hours)}>{frame.label}</button>)}
                </div>
              </div>
            </div>
            <div className="chart-title-row">
              <div><strong>{activeMetric.title}</strong><span>{latest ? `当前 ${valueText(metricValue(latest, metric), activeMetric.decimals)} ${activeMetric.unit}` : "设备上线后开始累计"}</span></div>
              <span className="chart-sample-count"><Database size={13} />本时段 {selectedSampleCount} 条样本 · {selectedReadings.length} 个时间点</span>
            </div>
            <div className="chart-range-status" role="status"><span>最近 {timeframes.find(frame => frame.hours === hours)?.label} · {formatTime(new Date(rangeStart).toISOString())} — {formatTime(new Date(rangeEnd).toISOString())}</span><span>{loading ? "正在更新所选时段…" : fetchError ? "更新失败，保留已获取记录" : payloadHours !== hours ? "正在切换时间范围…" : "按采集时间显示"}</span></div>
            <SensorChart readings={selectedReadings} metric={metric} rangeStart={rangeStart} rangeEnd={rangeEnd} loading={loading} failed={fetchError} />
          </section>

          <section className="glass-panel placement-panel">
            <div className="section-heading compact-heading"><div><div className="section-kicker">DEVICE LOCATION</div><h2>设备安放位置</h2></div><span className={`status-chip ${isOnline ? "is-online" : ""}`}><span className="status-dot" />{deviceStatus.unavailable ? "状态未知" : isOnline ? "握手在线" : "未确认握手"}</span></div>
            <div className="placement-content">
              <div className="placement-visual" aria-hidden="true"><div className="placement-room"><span className="placement-window" /><span className="placement-door" /><span className="placement-device"><AirVent size={17} /></span><span className="placement-pulse" /></div></div>
              <div className="placement-copy"><span className="placement-kicker"><MapPin size={14} />{selectedLocation.label}</span><strong>固定观测点</strong><p>CO₂、温度与相对湿度</p><span className="placement-note">点位位置可在设备安装后补充精确说明。</span></div>
            </div>
          </section>

          <div className="lower-grid">
            <section className="glass-panel readings-panel">
              <div className="section-heading compact-heading">
                <div><div className="section-kicker">RECENT SUMMARY</div><h2>最近汇总</h2></div>
                <span className="record-badge">{recentReadings.length} 个时间段</span>
              </div>
              <p className="readings-note">每行是一个时间段的平均值。<a href={`/api/records?location=${encodeURIComponent(location)}&limit=100`} target="_blank" rel="noreferrer">查看逐条原始数据 API <span aria-hidden="true">↗</span></a></p>
              {recentReadings.length ? (
                <div className="table-scroll">
                  <table className="readings-table">
                    <thead><tr><th>采集时间</th><th>CO₂</th><th>温度</th><th>湿度</th><th>样本数</th></tr></thead>
                    <tbody>{recentReadings.map((reading, index) => <tr key={`${reading.captured_at}-${index}`}><td><span className="record-time"><span className="record-dot" />{formatTime(reading.captured_at)}</span></td><td>{valueText(reading.co2_ppm, 0)} <small>ppm</small></td><td>{valueText(temperatureValue(reading))} <small>°C</small></td><td>{valueText(humidityValue(reading))} <small>%</small></td><td>{reading.sample_count ?? 1}</td></tr>)}</tbody>
                  </table>
                </div>
              ) : (
                <div className="table-empty"><span className="empty-check"><Check size={15} /></span><div><strong>这里还没有记录</strong><p>传感器首次上传后，读数和时间戳会出现在这里。</p></div></div>
              )}
            </section>

            <DeviceStatus status={deviceStatus} />
          </div>
          </> : activeView === "database" ? <ArchiveWorkspace detectAnomalies={findAnomalies} locationId={location} hours={hours} fallbackReadings={selectedReadings} onSetHours={setHours} onOpenApi={() => window.open(`/api/records?location=${encodeURIComponent(location)}&limit=500`, "_blank", "noopener,noreferrer")} /> : activeView === "plants" ? <PlantWorkspace /> : <Suspense fallback={<section className="glass-panel map-workspace"><p>正在载入三维地图…</p></section>}><CampusMap selectedPoint={location} onSelectPoint={setLocation} devices={deviceStatus.devices} onOpenOverview={() => setActiveView("overview")} /></Suspense>}

          <footer className="page-footer">
            <span>校园环境观测 · Cycle 01</span>
            <span className="footer-divider" />
            <span>{fetchError ? "暂时无法连接数据服务" : lastRefresh ? `页面更新于 ${lastRefresh.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "正在连接数据服务"}</span>
            <span className="footer-spacer" />
            <span className="footer-note"><CircleHelp size={13} />环境数据用于观察与讨论</span>
          </footer>
        </div>
      </section>
      {showDeviceGuide ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowDeviceGuide(false); }}>
          <section className="device-dialog glass-panel" role="dialog" aria-modal="true" aria-labelledby="device-dialog-title">
            <button className="dialog-close" type="button" onClick={() => setShowDeviceGuide(false)} aria-label="关闭">×</button>
            <div className="section-kicker">ADD A NODE</div><h2 id="device-dialog-title">添加采集设备</h2>
            <p>每台 ESP32 使用唯一的 DEVICE_ID，并配置所在点位 LOCATION_ID。新固件首次成功握手后，会自动出现在设备握手列表中。</p>
            <div className="dialog-note"><CircleHelp size={15} /><span>设备握手与测量上传分别显示。同一设备重启沿用原编号；多台设备不要共用编号。不要把设备密钥放进网页或公开消息。</span></div>
            <button className="dialog-primary" type="button" onClick={() => setShowDeviceGuide(false)}>知道了</button>
          </section>
        </div>
      ) : null}
    </main>
  );
}

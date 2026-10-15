import { useCallback, useEffect, useRef, useState } from "react";
import { AirVent, RefreshCw } from "lucide-react";
import "./device-status.css";

type Device = {
  device_id: string;
  location_id: string;
  last_handshake_at: string | null;
  last_upload_at: string | null;
  firmware_version: string | null;
  uptime_ms: number | null;
  sd_ready: boolean | null;
  scd_ready: boolean | null;
  sht_ready: boolean | null;
  clock_ready: boolean | null;
  record_count: number;
};
type DevicesPayload = { ok: boolean; devices: Device[]; serverTime: string; handshakeTimeoutMs: number };

export function useDeviceStatus() {
  const [snapshot, setSnapshot] = useState<{ payload: DevicesPayload; fetchedAt: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    try {
      const response = await fetch("/api/devices", { cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]) });
      if (!response.ok) throw new Error("Status unavailable");
      const payload = await response.json() as DevicesPayload;
      if (!payload.ok || !Array.isArray(payload.devices) || !Number.isFinite(Date.parse(payload.serverTime)) || !Number.isFinite(payload.handshakeTimeoutMs)) throw new Error("Invalid device status");
      if (!request.signal.aborted) { setSnapshot({ payload, fetchedAt: Date.now() }); setFailed(false); }
    } catch { if (!request.signal.aborted) setFailed(true); }
    finally { if (!request.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const poll = window.setInterval(() => void refresh(), 15_000);
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => { window.clearInterval(poll); window.clearInterval(tick); controller.current?.abort(); };
  }, [refresh]);
  // Use server time plus elapsed time; the visitor's clock may be misconfigured.
  const serverNow = snapshot ? Date.parse(snapshot.payload.serverTime) + Math.max(0, now - snapshot.fetchedAt) : now;
  const unavailable = failed || !snapshot || now - snapshot.fetchedAt > 45_000;
  const devices = (snapshot?.payload.devices ?? []).map(device => ({
    ...device,
    handshake: unavailable ? "unavailable" : !device.last_handshake_at ? "unknown"
      : serverNow - Date.parse(device.last_handshake_at) < snapshot!.payload.handshakeTimeoutMs ? "online" : "expired",
    uploadFresh: Boolean(device.last_upload_at && serverNow - Date.parse(device.last_upload_at) < 150_000),
  }));
  return { devices, unavailable, loading, failed, refresh };
}

const timestamp = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "暂无记录";
const stateLabel: Record<string, string> = { online: "握手在线", expired: "握手已超时", unknown: "尚无设备握手记录", unavailable: "状态暂不可用" };
type Status = ReturnType<typeof useDeviceStatus>;

export default function DeviceStatus({ status }: { status: Status }) {
  return <section className="glass-panel status-panel device-status-panel">
    <div className="section-heading compact-heading"><div><div className="section-kicker">DEVICE HANDSHAKE</div><h2>设备握手状态</h2></div>
      <button type="button" className="quiet-icon-button" onClick={() => void status.refresh()} disabled={status.loading} aria-label="刷新设备握手状态"><RefreshCw size={16} /></button></div>
    <p className="device-status-note">每台设备独立显示 · 120 秒握手 · 超过 5 分钟未确认则超时</p>
    {status.unavailable ? <p role="status" className="device-status-warning">{status.loading && !status.failed ? "正在读取设备状态…" : "握手状态接口暂不可用；保留上次记录，当前状态未知。"}</p> : null}
    {status.devices.map(device => <article className="device-handshake-card" key={device.device_id}>
      <div className="device-handshake-heading"><AirVent size={20} /><div><strong>{device.device_id}</strong><span>点位 {device.location_id}</span></div><span className={`handshake-badge ${device.handshake === "expired" ? "is-warning" : ""}`}>{stateLabel[device.handshake]}</span></div>
      <dl className="handshake-details">
        <div><dt>最近成功握手</dt><dd>{timestamp(device.last_handshake_at)}<small>北京时间 UTC+8</small></dd></div>
        <div><dt>最近收到数据</dt><dd>{timestamp(device.last_upload_at)}<small>{status.unavailable ? "当前上传状态未知" : device.uploadFresh ? "近期收到数据" : "暂无近期上传"} · 累计 {device.record_count} 条</small></dd></div>
        <div><dt>SD 卡</dt><dd className={device.sd_ready === false ? "is-warning" : ""}>{device.sd_ready === null ? "未上报" : device.sd_ready ? "已就绪" : "不可用 · 存储与上传暂停"}<small>最近成功握手时的状态</small></dd></div>
        <div><dt>传感器 / 校时</dt><dd>SCD41 {device.scd_ready === null ? "未知" : device.scd_ready ? "就绪" : "未就绪"} · {device.clock_ready === null ? "校时未知" : device.clock_ready ? "已校时" : "未校时"}<small>SHT31 {device.sht_ready === null ? "未知" : device.sht_ready ? "就绪" : "未接入或不可用"}</small></dd></div>
        <div><dt>固件版本</dt><dd>{device.firmware_version ?? "未上报"}</dd></div>
      </dl>
      {device.handshake === "unknown" ? <p className="device-status-note">历史读数已识别该设备；烧录支持设备身份握手的新固件后可显示连接状态。</p> : null}
    </article>)}
    {!status.unavailable && !status.devices.length ? <p className="device-status-note">尚未收到设备身份握手或测量记录。首次握手成功后，设备会自动出现在这里。</p> : null}
    <p className="device-status-note">握手成功表示设备可访问服务器；SD 故障时仍可握手，测量上传状态单独判断。</p>
  </section>;
}

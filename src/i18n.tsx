import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Language = "zh" | "en";

const translations: Record<string, string> = {
  "校园观测": "Campus Atlas", "工作区": "WORKSPACE", "本期节点": "ACTIVE NODES",
  "环境概览": "Overview", "数据档案": "Data Archive", "植物样方": "Plant Surveys", "点位地图": "Campus Map",
  "概览": "Overview", "档案": "Archive", "样方": "Surveys", "地图": "Map", "导出": "Export", "添加": "Add",
  "数据导出接口": "Data Export API", "添加设备": "Add Device", "校园环境档案": "Campus Environment Archive",
  "让可见的数据，成为下一步改善的依据。": "Making visible data a foundation for the next improvement.",
  "测量与记录": "Measurement & Records", "公开展示模式": "Public Display", "校园环境": "Campus Environment",
  "每 15 秒更新": "Updates every 15 sec", "点击刷新当前点位握手状态和数据": "Refresh this location’s handshake status and readings",
  "状态未知": "Status unknown", "握手在线": "Handshake online", "握手超时": "Handshake timed out", "待设备握手": "Awaiting device handshake",
  "握手已超时": "Handshake timed out", "握手状态待确认": "Handshake pending", "未确认握手": "Handshake unconfirmed", "尚未接入": "Not connected",
  "立即刷新": "Refresh now", "主导航": "Main navigation", "移动端导航": "Mobile navigation",
  "校园环境概览": "Campus Environment Overview", "校园数据档案": "Campus Data Archive", "植物样方记录": "Plant Survey Records", "校园点位地图": "Campus Points Map",
  "从一个房间开始，建立可持续复测的环境档案。": "Build a repeatable environmental record, one room at a time.",
  "每一层都是一段真实观测；沿时间切片回看校园环境。": "Each layer is a real observation. Move through time to revisit campus conditions.",
  "记录莲花馆外候选样方的植物物种与覆盖率。": "Record plant species and ground cover at candidate plots outside the Lotus Hall.",
  "查看已接入设备与待调查样方候选点。": "Explore connected devices and candidate survey plots.",
  "当前环境数据来源教室": "Classroom providing the current readings", "握手在线设备": "Devices with an active handshake",
  "正在获取握手状态": "Checking handshake status", "按设备独立确认连接": "Connection confirmed per device", "当前点位时段均值": "Selected location · period average",
  "最近": "Last", "温度": "Temperature", "湿度": "Humidity", "二氧化碳": "Carbon dioxide", "室内温度": "Room temperature", "相对湿度": "Relative humidity",
  "当前采样频率": "Sampling frequency", "次 / 分钟": "samples / min", "固件设定 · 每 60 秒采样": "Firmware setting · one sample every 60 seconds",
  "环境变化": "Environmental change", "选择趋势指标": "Choose a trend metric", "选择时间范围": "Choose a time range",
  "设备上线后开始累计": "Collection starts when a device comes online", "本时段": "This period", "条样本": "samples", "个时间点": "time points",
  "正在更新所选时段…": "Updating the selected period…", "更新失败，保留已获取记录": "Update failed; keeping the records already loaded",
  "正在切换时间范围…": "Changing the time range…", "按采集时间显示": "Shown by collection time", "设备安放位置": "Device location",
  "固定观测点": "Fixed observation point", "CO₂、温度与相对湿度": "CO₂, temperature, and relative humidity",
  "点位位置可在设备安装后补充精确说明。": "A precise location description can be added after the device is installed.",
  "最近汇总": "Recent summary", "个时间段": "periods", "每行是一个时间段的平均值。": "Each row shows the average for one period.",
  "查看逐条原始数据 API": "View raw readings API", "采集时间": "Collected at", "样本数": "Samples",
  "这里还没有记录": "No records yet", "传感器首次上传后，读数和时间戳会出现在这里。": "Readings and timestamps will appear here after the sensor’s first upload.",
  "暂时无法连接数据服务": "Unable to connect to the data service", "正在连接数据服务": "Connecting to the data service",
  "环境数据用于观察与讨论": "Environmental data is for observation and discussion", "关闭": "Close", "知道了": "Got it",
  "添加采集设备": "Add a collection device", "每台 ESP32 使用唯一的 DEVICE_ID，并配置所在点位 LOCATION_ID。新固件首次成功握手后，会自动出现在设备握手列表中。": "Give each ESP32 a unique DEVICE_ID and configure its LOCATION_ID. It will appear in the device handshake list after its first successful handshake with updated firmware.",
  "设备握手与测量上传分别显示。同一设备重启沿用原编号；多台设备不要共用编号。不要把设备密钥放进网页或公开消息。": "Device handshakes and reading uploads are shown separately. A device keeps its ID after restarting; give each device a different ID. Never put device keys in this page or in public messages.",
  "等待设备数据": "Waiting for device data", "时间待同步": "Time not synchronized", "1 小时": "1 hour", "6 小时": "6 hours", "24 小时": "24 hours", "7 天": "7 days",
  "时间轴已自动细化": "Time scale refined automatically", "变化趋势图": "trend chart", "用当前图表中相邻最多 6 个时间段的中位数和 MAD 估算局部基线。标记用于提醒复核，不代表传感器故障或空气质量安全结论。": "Local baseline estimated from the median and MAD of up to six neighboring periods. Markers prompt review; they do not prove sensor failure or determine air-quality safety.",
  "筛查到": "Detected", "段异常波动": "anomalous intervals", "个时段": "intervals", "未发现明显异常波动": "No clear anomalous variation detected", "基于邻近读数偏离筛查": "Screened for deviations from nearby readings",
  "正在读取所选时段…": "Loading readings for this period…", "这个时段的数据暂时无法读取": "Readings for this period are temporarily unavailable", "所选时段暂无有效读数": "No valid readings for this period",
  "请稍后重试，或选择其他时间范围。": "Try again later or choose another time range.", "可以切换到更长时段查看历史记录；空白时间段表示没有观测数据。": "Choose a longer range to view history. Blank periods indicate that no observations were recorded.",
  "异常波动": "anomalous variation", "出现偏离邻近读数的波动": "deviation from nearby readings",
  "样方 A · 北侧草地": "Plot A · North Lawn", "样方 B · 中部花坛": "Plot B · Central Garden", "样方 C · 南侧树荫": "Plot C · South Shade",
  "环境传感器点位 · 数据编号 M1": "Environmental sensor point · data ID M1", "待调查点位": "Candidate survey point", "已识别设备点位": "Recognized device point",
  "FIELD OBSERVATION": "FIELD OBSERVATION", "记录植物样方": "Record a plant survey", "莲花馆外 · A/B/C": "Outside Lotus Hall · A/B/C",
  "每次记录一个 1m × 1m 样方。记录保存在当前浏览器，便于现场采集和后续导出核对。": "Record one 1 m × 1 m plot at a time. Entries are saved in this browser for field work and later review or export.",
  "样方点位": "Survey plot", "北侧草地": "North Lawn", "中部花坛": "Central Garden", "南侧树荫": "South Shade", "植物物种数": "Number of plant species",
  "例如 6": "e.g. 6", "植被覆盖率（%）": "Vegetation cover (%)", "例如 72": "e.g. 72", "观察备注": "Observation notes",
  "可记录修剪、施工或天气情况": "Note mowing, construction, or weather", "保存本次记录": "Save this record", "样方记录": "Survey log",
  "删除": "Delete", "还没有样方记录": "No survey entries yet", "填写左侧表单即可开始记录；数据会保存在这台设备的浏览器中。": "Use the form to start recording. Entries are saved in this device’s browser.",
  "种植物 · 覆盖率": "species · cover", "个样本": "samples", "等待数据": "Waiting for data", "当前选择": "Selected", "没有匹配": "No match",
  "接收时间 · 采集未校时": "Received at · device time not synchronized", "接收时间": "Received at", "采集时间未知": "Collection time unknown",
  "全部时间": "All time", "日期或时间无效，请检查输入": "Invalid date or time. Check your entry.", "日期待同步": "Date not synchronized",
  "空间开场": "Space", "教室轮廓": "Room outline", "现场观测": "Field observation", "校园，": "Campus,", "逐间展开。": "room by room.",
  "从空间的轮廓出发，": "Start with the shape of a space,", "找到每一次观测发生的地方。": "and locate where each observation took place.", "走近，": "Step into", "这处空间。": "this space.",
  "独立展开房间边界，换一个角度看校园。": "Explore this room on its own and see the campus from a different angle.", "图纸轮廓面积": "Plan area", "示意墙高": "Illustrative wall height",
  "依据 FF-01 图纸生成，尺寸尚未经现场测量核验。": "Generated from the FF-01 plan. Dimensions have not yet been verified on site.", "让观测，": "Bring observation", "回到现场。": "back to the field.",
  "设备状态": "Device status", "查看环境数据": "View environmental data", "前往设备教室 M104": "Go to device room M104", "设备安装位置：M104 · 历史数据点位：M1": "Device installed in M104 · historical data point M1",
  "展示章节": "Presentation chapters", "上一个教室": "Previous room", "下一个教室": "Next room", "切换空间": "Change room", "返回开场": "Back to start", "向下滚动探索": "Scroll to explore",
  "3D 场景暂时不可用": "3D scene is temporarily unavailable", "你仍可以搜索房间、查看位置与设备信息。": "You can still search rooms and view location and device information.", "重新加载 3D": "Reload 3D scene",
  "跟随页面滚动转动和移动的独立教室三维模型，鼠标拖动可调整角度": "Standalone 3D room model follows page scrolling; drag with the mouse to adjust its angle",
  "此浏览器暂不支持 3D 显示，请启用硬件加速或换用支持 WebGL 的浏览器。": "This browser does not support 3D display. Enable hardware acceleration or use a WebGL-compatible browser.",
  "FF-01 三维楼层地图，拖动旋转，滚轮缩放": "FF-01 3D floor map. Drag to rotate; use the scroll wheel to zoom.", "3D 显示连接中断，可以重新加载模型。": "The 3D display was interrupted. Reload the model to try again.", "模型文件读取失败": "Could not read the model file", "模型加载失败，请重试。": "Model failed to load. Try again.",
  "模型视图切换": "Model view", "沉浸浏览": "Immersive view", "全校地图": "Campus map", "选择教室": "Choose a room", "地图视角控制": "Map view controls",
  "查看全图": "View full map", "全图": "Full map", "立体": "3D", "俯视": "Top view", "聚焦": "Focus", "走进": "Enter", "拖动旋转 · 滚轮缩放 · 点击房间选择": "Drag to rotate · scroll to zoom · click a room to select",
  "正在载入三维地图…": "Loading 3D campus map…", "暂时无法显示地图": "Map temporarily unavailable", "首次加载约 7.2 MB": "First load is about 7.2 MB", "重新加载": "Reload",
  "关闭教室目录": "Close room directory", "找到那间教室。": "Find your room.", "搜索房间编号": "Search room number", "搜索房间，例如 M104": "Search rooms, e.g. M104", "个匹配空间": "matching spaces",
  "房间列表": "Room list", "设备教室": "Device room", "没有匹配的房间，试试其他编号。": "No matching rooms. Try another number.",
  "当前环境采集设备安装在此教室。历史数据沿用点位编号 M1。": "The environmental sensor is installed in this room. Historical readings use point ID M1.", "模型中的空间编号；此处的设备安装情况尚未确认。": "Space ID from the model. Device installation here has not been confirmed.",
  "依据 FF-01 图纸生成。位置与尺寸尚未经现场测量核验；户外样方未添加推测标记。": "Generated from the FF-01 plan. Locations and dimensions have not been verified on site; no speculative outdoor plot markers are shown.",
  "房间": "Room", "暂时未知": "Temporarily unknown", "尚无设备握手记录": "No device handshake recorded", "状态暂不可用": "Status temporarily unavailable",
  "刷新设备握手状态": "Refresh device handshake status", "正在刷新握手状态": "Refreshing handshake status", "握手状态": "Handshake status",
  "最近成功握手": "Last successful handshake", "北京时间 UTC+8": "China Standard Time (UTC+8)", "最近收到数据": "Last data received", "当前上传状态未知": "Upload status unknown", "近期收到数据": "Data received recently", "暂无近期上传": "No recent uploads", "累计": "Total",
  "传输方式": "Transport", "本地缓存": "Local cache", "SD 卡": "SD card", "Wi-Fi / HTTPS · 采集后直接上传": "Wi-Fi / HTTPS · upload after collection", "失败暂存最多 30 条；确认后移除；重启清空": "Up to 30 failed uploads are queued; removed after confirmation; cleared on restart",
  "上传确认后保留最新 10 条；重启会清空": "Keeps the latest 10 entries after upload confirmation; cleared on restart", "最近成功握手时的状态": "Status at last successful handshake",
  "已就绪": "Ready", "不可用 · 存储与上传暂停": "Unavailable · storage and upload paused", "传感器 / 校时": "Sensors / clock",
  "未知": "Unknown", "就绪": "Ready", "校时未知": "Clock status unknown", "已校时": "Synchronized", "未校时": "Not synchronized", "未就绪": "Not ready", "未接入或不可用": "Not connected or unavailable", "未上报": "Not reported",
  "历史读数已识别该设备；烧录支持设备身份握手的新固件后可显示连接状态。": "Historical readings identify this device. Flash firmware with device-identity handshakes to show its connection status.",
  "设备握手状态": "Device handshake status", "每台设备独立显示 · 120 秒握手 · 超过 5 分钟未确认则超时": "Status shown per device · 120-second handshake · marked timed out after 5 minutes without confirmation",
  "正在读取设备状态…": "Loading device status…", "握手状态接口暂不可用；保留上次记录，当前状态未知。": "Handshake status is unavailable. Keeping the previous record; current status is unknown.",
  "尚未收到设备身份握手或测量记录。首次握手成功后，设备会自动出现在这里。": "No device handshake or readings have been received. A device will appear here after its first successful handshake.",
  "握手成功表示设备可访问服务器；测量上传状态单独判断。": "A successful handshake means the device can reach the server. Reading uploads are reported separately.",
  "表单验证":"Form validation", "分钟":"minute", "天":"days", "今天":"Today", "昨天":"Yesterday", "近 7 天":"Last 7 days", "重置":"Reset",
  "找到那一分钟。":"Find that minute.", "直接输入 20:08、10-14 或 10-14 20:08":"Enter a time such as 20:08, 10-14, or 10-14 20:08", "搜索日期或时间，精确到分钟":"Search by date and time, to the exact minute", "清除时间筛选":"Clear time filter",
  "正在读取观测记录…":"Loading observations…", "等待观测数据":"Waiting for observations", "滚轮 / ↑ ↓ 选择时间层":"Scroll / ↑ ↓ to choose a time layer", "暂无匹配记录":"No matching records", "原始观测":"Raw observation", "趋势均值":"Trend average", "疑似异常波动 · 建议复核 CO₂ 记录":"Possible anomaly · review the CO₂ reading",
  "该时段暂时没有观测数据。":"No observations are available for this period.", "当前":"Current", "异常":"Anomaly", "观测":"Observation", "已载入":"Loaded", "条原始记录。":"raw records.", "搜索仅覆盖已载入数据。":"Search covers loaded data only.",
  "记录刷新失败，已保留载入的数据，请稍后重试。":"Could not refresh records. Loaded data has been kept; try again later.", "正在载入…":"Loading…", "加载更早记录":"Load older records", "更早":"Older", "数据接口":"Data API", "更新":"Newer",
  "服务器接收于":"Received by server at", "服务器接收时间":"Server receipt time", "已载入数据中没有匹配；可修改时间或加载更早记录。":"No match in loaded data. Change the time or load older records.",
  "M 区 · M104 教室": "Zone M · Room M104", "M104 教室": "Room M104", "点位 M1": "Point M1", "编号": "ID", "点位": "Point",
  "页面更新于": "Page updated at", "小时": "hours", "时间": "Time", "来源": "Source", "教室": "Room",
  "切换语言为中文": "Switch to Chinese", "°C": "°C",
  "暂无记录": "No records",
  "环境记录时间层": "Environmental record timeline", "时间层选择器，向下滚动查看更早记录，也可使用上下方向键": "Timeline selector. Scroll down to view older records, or use the arrow keys.",
  "新记录": "new records", "条匹配": "matches", "输入 20:08、10-14 或 今天 20:08": "Enter 20:08, 10-14, or Today 20:08",
  "设备握手记录尚未收到": "No device handshake has been received", "采集时尚未校时": "device clock was not synchronized at collection", "时间戳": "timestamp",
  "候选样方": "candidate survey plots", "莲花馆外": "Outside Lotus Hall", "点位位置": "Point location", "所选时段": "Selected period",
  "选择时间层": "Choose a time layer", "数据库": "Database", "校时": "Clock sync", "现场": "Field", "室内": "Indoor", "设备": "Device", "采样": "Sampling",
  "当前点位": "Selected point", "采集": "Collection", "数据": "data", "刷新": "Refresh", "连接": "Connection", "搜索": "Search",
  "时间轴": "Timeline", "记录时间": "Record time", "原始数据": "Raw data", "平均值": "Average", "文件": "file", "房间编号": "Room number",
  "条": "records", "条样本": "samples", "个时间段": "periods", "个设备": "devices", "个匹配空间": "matching spaces", "节点": "node", "种植物": "plant species", "覆盖率": "cover",
};

function translateDynamic(source: string): string {
  const text = source.trim();
  const pad = (value: string) => `${source.match(/^\s*/)?.[0] ?? ""}${value}${source.match(/\s*$/)?.[0] ?? ""}`;
  let match = text.match(/^(\d+)\s*条$/);
  if (match) return pad(`${match[1]} records`);
  match = text.match(/^(\d+)\s*台设备$/);
  if (match) return pad(`${match[1]} devices`);
  match = text.match(/^设备点位\s*·\s*(.+)$/);
  if (match) return pad(`Device point · ${match[1]}`);
  match = text.match(/^删除\s+(.+)\s+样方记录$/);
  if (match) return pad(`Delete ${match[1]} plot entry`);
  match = text.match(/^筛查到\s*(\d+)\s*段异常波动\s*·\s*(\d+)\s*个时段$/);
  if (match) return pad(`${match[1]} anomalous intervals detected · ${match[2]} readings`);
  match = text.match(/^本时段\s*(\d+)\s*条样本\s*·\s*(\d+)\s*个时间点$/);
  if (match) return pad(`${match[1]} samples · ${match[2]} time points in this period`);
  match = text.match(/^已载入\s*(\d+)\s*\/\s*(\d+)\s*条原始记录。$/);
  if (match) return pad(`${match[1]} / ${match[2]} raw records loaded.`);
  match = text.match(/^(.+)\s*种植物\s*·\s*覆盖率\s*(\d+(?:\.\d+)?)%$/);
  if (match) return pad(`${match[1]} plant species · ${match[2]}% cover`);
  match = text.match(/^最近\s*(\d+)\s*小时$/);
  if (match) return pad(`Last ${match[1]} hours`);
  match = text.match(/^最近\s*(\d+)\s*分钟$/);
  if (match) return pad(`Last ${match[1]} minutes`);
  match = text.match(/^当前\s*(.+)$/);
  if (match) return pad(`Current ${match[1]}`);
  match = text.match(/^(.+)变化趋势图$/);
  if (match) return pad(`${translateDynamic(match[1])} trend chart`);
  match = text.match(/^(.+?)：(.+)出现偏离邻近读数的波动$/);
  if (match) return pad(`${match[1]}: ${translateDynamic(match[2])} variation from nearby readings`);
  match = text.match(/^INDEX\s*(\d+)\s*\/\s*(\d+)$/);
  if (match) return pad(`INDEX ${match[1]} / ${match[2]}`);
  if (translations[text]) return pad(translations[text]);
  const localized = Object.entries(translations)
    .filter(([key]) => key.length >= 2 && text.includes(key))
    .sort(([left], [right]) => right.length - left.length)
    .reduce((result, [key, value]) => result.replaceAll(key, value), text);
  return pad(localized);
}

type LanguageContextValue = { language: Language; setLanguage: (language: Language) => void };
const LanguageContext = createContext<LanguageContextValue | null>(null);
const STORAGE_KEY = "campus-atlas-language-v1";
const originalText = new WeakMap<Text, { original: string; translated: string }>();
const originalAttributes = new WeakMap<Element, Map<string, { original: string; translated: string }>>();

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    try { return window.localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "zh"; } catch { return "zh"; }
  });
  const contextValue = useMemo(() => ({ language, setLanguage }), [language]);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, language); } catch { /* Storage can be disabled. */ }
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";

    const attributes = ["aria-label", "aria-description", "title", "placeholder"];

    const visit = (root: Node) => {
      const elements: Element[] = [];
      if (root instanceof Element) elements.push(root);
      if (root instanceof Document || root instanceof Element) elements.push(...root.querySelectorAll("*"));
      const localizeText = (node: Text) => {
        if (node.parentElement?.closest("[data-no-translate='true']")) return;
        const current = node.nodeValue ?? "";
        const saved = originalText.get(node);
        const original = !saved || (current !== saved.translated && current !== saved.original) ? current : saved.original;
        const translated = language === "en" ? translateDynamic(original) : original;
        originalText.set(node, { original, translated });
        if (current !== translated) node.nodeValue = translated;
      };
      if (root.nodeType === Node.TEXT_NODE) localizeText(root as Text);
      const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let textNode: Node | null;
      while ((textNode = textWalker.nextNode())) localizeText(textNode as Text);
      for (const element of elements) {
        if (element.closest("[data-no-translate='true']")) continue;
        for (const attribute of attributes) {
          if (!element.hasAttribute(attribute)) continue;
          let saved = originalAttributes.get(element);
          if (!saved) { saved = new Map(); originalAttributes.set(element, saved); }
          const current = element.getAttribute(attribute) ?? "";
          const previous = saved.get(attribute);
          const original = !previous || (current !== previous.translated && current !== previous.original) ? current : previous.original;
          const translated = language === "en" ? translateDynamic(original) : original;
          saved.set(attribute, { original, translated });
          if (current !== translated) element.setAttribute(attribute, translated);
        }
      }
    };

    visit(document.body);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "childList") record.addedNodes.forEach(visit);
        else if (record.type === "characterData" && record.target.parentNode) visit(record.target.parentNode);
        else if (record.type === "attributes") visit(record.target);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attributes });
    return () => observer.disconnect();
  }, [language]);

  return <LanguageContext.Provider value={contextValue}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used inside LanguageProvider");
  return context;
}

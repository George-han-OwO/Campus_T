# 校园观测 · 自托管部署包

源码仓库：[George-han-OwO/Campus_T](https://github.com/George-han-OwO/Campus_T)。每次更新内容、验证结果及烧录/部署要求见 [CHANGELOG.md](./CHANGELOG.md)；仓库协作规则见 [AGENTS.md](./AGENTS.md)。

**当前部署入口：**用户已在 Windows 主机启动 MSA-SC Tunnel。请优先阅读 [DEPLOY_WINDOWS_TUNNEL.md](./DEPLOY_WINDOWS_TUNNEL.md)，使用单独的 `docker-compose.windows-tunnel.yml`；Cloudflare 服务地址为 `http://127.0.0.1:3000`。下文默认 Compose 的 `http://atlas:3000` 仅适用于连接器和网站都运行在同一 Docker 网络的方式。

这是校园环境监测的第一版可部署原型：ESP32-S3 采集 SCD41 的 CO₂ 与温湿度、SHT31 的温湿度；MicroSD 暂存未上传记录；网络恢复后通过 HTTPS 分批补传。公开网页每 15 秒刷新一次，未接入设备时不显示虚构读数。

## 下载更新包

- [最新正式发布与更新说明](https://github.com/George-han-OwO/Campus_T/releases/latest)
- [网站部署包](https://github.com/George-han-OwO/Campus_T/releases/latest/download/campus-atlas-server.zip)：网站、接口、部署配置、说明及固件源码；保留服务器原有 `.env` 和数据库。
- [ESP32 固件源码包](https://github.com/George-han-OwO/Campus_T/releases/latest/download/campus-node-firmware.zip)：解压后打开 `CampusNode/CampusNode.ino`，保留已有 `secrets.h`，按固件说明编译、烧录；这是源码包，未包含通用烧录二进制。
- [SHA-256 校验文件](https://github.com/George-han-OwO/Campus_T/releases/latest/download/SHA256SUMS.txt)

发布包只包含对应标签中的源码和示例配置，不含真实密钥、数据库或依赖缓存。首次部署请阅读下方说明。GitHub 自动生成的 Source code 压缩包为仓库快照，面向部署的文件请优先选择上述附件。

## 包含内容

- `src/`：黑白、液态玻璃风格的响应式仪表盘
- `server/index.js`：公开历史读取 API 与设备密钥保护的上传 API
- SQLite：随应用启动建表，数据库保存到 Docker 持久卷
- `Dockerfile`、`docker-compose.yml`：网站容器和 Cloudflare Tunnel 连接器
- `firmware/CampusNode/CampusNode.ino`：ESP32-S3 + SCD41 + SHT31 + MicroSD 固件
- `DEPLOY_WITH_CODEX.md`：可直接交给服务器上 Codex 执行的部署任务

## 数据流

1. ESP32 每 60 秒读取一次 SCD41 与 SHT31，把采集时刻（UTC，精确到秒）和读数一起写入 SD 卡 `/atlas-queue/` 的分段队列，每段最多 64 MiB。
2. 每次保存后立即尝试通过 HTTPS 上传，每批最多 10 条；服务器确认后持久化读取游标，整段读完才释放文件，不必反复复制大文件。还有积压时，每批确认后等待约 1 秒继续补传；上传请求本身的耗时取决于网络。
3. 连接失败时，使用 5 秒起步、逐步延长到最多 15 分钟的重试间隔。相同记录 ID 可安全重传。队列达到 10 GB 时，删除最旧约 5.5 GB 的分段；该容量规则也可能删除尚未上传的旧记录。
4. 网页从服务器公开读取最新数据和历史聚合值，每 15 秒刷新。上传 API 需要 `Authorization: Bearer <DEVICE_API_TOKEN>`。

设备在开机连上 Wi-Fi 并完成校时后，先向 `/api/device/handshake` 发送带设备密钥的 HTTPS 请求。未校时成功时每 60 秒重新请求一次 NTP，期间记录留在 SD 卡。收到服务器的 204 确认后才开始上传 SD 队列；此后每 120 秒再握手一次。握手失败或 Wi-Fi 断开时仍继续采样并保存到 SD，恢复确认后补传。服务器与固件需要同时更新：旧服务器没有握手接口，新固件收到 404 时会保留记录并暂停上传。

### 每台设备的握手状态

概览中的“设备握手状态”按 `device_id` 单独列出设备，显示最近成功握手、最近收到数据、SD 卡、传感器、校时和固件版本；时间使用北京时间，精确到秒。侧栏自动列出已识别设备，可点击切换到对应点位。

固件 `2026.10.15-device-handshake` 在握手正文中带上设备身份及当前状态。每台物理设备设置不同的 `DEVICE_ID`，重启时沿用原编号。服务器将最近成功握手持久化；每 120 秒握手一次，超过 5 分钟未收到成功握手，页面标注“握手已超时”。近期上传单独按最近 150 秒是否收到测量记录判断；SD 故障不会阻止握手，但当前存储策略仍暂停读数上传。页面每 15 秒刷新状态；接口不可用时显示状态未知，不能据此断定设备离线。

旧固件的空正文 `{}` 仍可获得 204，但无法归属设备，不更新任何设备握手时间。只上传过历史读数的设备显示“尚无设备握手记录”。请同时更新服务器并重新烧录新固件；旧服务器即使返回 204 也不会记录设备身份。服务器无法知道尚未到达它的 Wi-Fi、NTP 或 TLS 失败，首次身份握手前不会凭空创建节点；超过时限也只说明近期没有收到确认。

## 服务器部署

### 已有部署更新（2026-10-15）

本次同时更新网站与 ESP32 固件，两端需要分别应用。服务器保留现有 `.env`、数据库和 Docker 卷；使用现有 Windows Tunnel，不重建连接器。已经以 Docker 运行的网站，在原部署目录更新源码后运行 `docker compose -f docker-compose.windows-tunnel.yml config --quiet`，再运行 `docker compose -f docker-compose.windows-tunnel.yml up -d --build`。如果原来以 Node 运行，则沿用现有进程管理方式，安装锁定依赖、执行 `npm run build` 后重启该项目。

ESP32 在原草图目录更新 `CampusNode.ino`，并新增同包的 `SdRecordQueue.h`，保留自己已配置的 `secrets.h`。用原板卡和端口重新烧录；串口出现 `Firmware: 2026.10.15-sd-retention` 才表示新固件已生效。采样仍为每 60 秒一次，保存后即安排上传；网站每 15 秒读取更新。档案页只有真正收到新记录时才播放时间层入场动画，并保留正在浏览的历史选择。

服务器没有公网 IP 时使用 Cloudflare Tunnel：服务器只需能向外连接 Cloudflare，通常不需要路由器转发或开放公网入站端口。先确认已有主域名区域 `georgehan0514.top` 在 Cloudflare 中为 Active，再为 `map.georgehan0514.top` 添加 Public Hostname。**当前 Tunnel 在 Windows 主机运行，源站服务填写 `http://127.0.0.1:3000`。**Cloudflare 会用隧道 CNAME 代理该子域名，不需要把 A 记录指向服务器 IP。服务器出站防火墙需允许 Tunnel 连接使用的 TCP/UDP 7844。

经 Cloudflare Tunnel 的 HTTPS 证书在 Cloudflare 边缘终止。2026-10-14 检查时，`map.georgehan0514.top` 的证书链经过 Google Trust Services 的 GTS Root R4；固件现内置 GTS Root R4 和 ISRG Root X1，继续校验证书。Cloudflare 以后可能更换签发 CA；若出现 TLS 握手错误，应重新检查实际证书链并更新固件信任根证书，不要关闭证书校验。

把本目录解压到服务器自己的项目目录，再按 [`DEPLOY_WITH_CODEX.md`](./DEPLOY_WITH_CODEX.md) 部署。先在 Cloudflare 建立 Tunnel 和 Public Hostname，再在服务器项目目录执行：

```sh
node scripts/init-env.mjs map.georgehan0514.top
```

初始化脚本会生成强随机设备密钥并写入被 Git 忽略的 `.env`。通过安全的服务器远程桌面会话将 Cloudflare Tunnel 的 `TUNNEL_TOKEN` 加入 `.env` 后，再启动：

```sh
docker compose up -d --build
```

不要把 `.env` 放入部署压缩包、代码仓库或公开消息，也不要让 Codex 在聊天或日志里输出 token。

部署完成后，页面地址为 `https://map.georgehan0514.top/`，设备接口为 `https://map.georgehan0514.top/api/readings`。健康状态可通过 `https://map.georgehan0514.top/api/health` 查看。

## ESP32-S3 接线

I2C 共用一条总线，SCD41 与 SHT31 并联连接。你当前的 SDA/SCL 接法保持不变。

| 模块引脚 | ESP32-S3／电源 | 说明 |
| --- | --- | --- |
| SCD41 VIN | ESP32-S3 3V3 | 模块标注 VIN 3–5V；此处使用 3.3V |
| SCD41 GND | GND | 与 ESP32 和 SD 供电共地 |
| SCD41 SCL | GPIO 4 | 你已经选定 |
| SCD41 SDA | GPIO 5 | 你已经选定 |
| SCD41 3Vo | 不连接 | 模块上的稳压输出脚，不用作输入 |
| SHT31 VIN/VCC | ESP32-S3 3V3 | 如果你的板子引脚标成 VIN，则先确认模块标注支持 3.3V |
| SHT31 GND/SCL/SDA | GND / GPIO 4 / GPIO 5 | 与 SCD41 并联；SHT31 常见地址为 0x44，固件也尝试 0x45 |
| MicroSD VCC | 同一个 USB 5V 电源的 +5V 分支 | 你展示的模块要求 4.5–5.5V；不要接 3V3 |
| MicroSD GND | 同一电源 GND | 必须与 ESP32 GND 相连 |
| MicroSD CS | GPIO 10 | 固件显式配置的 ESP32-S3 SPI 引脚 |
| MicroSD MOSI | GPIO 11 | 同上 |
| MicroSD MISO | GPIO 13 | 同上 |
| MicroSD SCK | GPIO 12 | 同上 |

ESP32 通过 USB-C 正常供电；SD 模块从同一个 5V USB 电源分出 5V 和 GND，两个设备共地。不要并接两个不同的 5V 电源。如果你的开发板没有引出 GPIO 10–13，换用空闲 GPIO，并同步修改固件顶部的 SPI 引脚常量。

## 烧录固件

1. Arduino IDE 安装 ESP32 Arduino core、`Sensirion I2C SCD4x` 和 `Adafruit SHT31` 库。
2. 将 `firmware/CampusNode/secrets.example.h` 复制为同一目录下的 `firmware/CampusNode/secrets.h`。
3. 在本机 `firmware/CampusNode/secrets.h` 填入两组 2.4 GHz Wi-Fi、部署后的 HTTPS 地址，以及服务器 `.env` 中的 `DEVICE_API_TOKEN`。固件先尝试第一组 5 次，再尝试第二组 5 次；两组都失败时持续轮询。真实密码和设备密钥不要上传到仓库或放进网站前端。
4. 在 Arduino IDE 打开 `firmware/CampusNode/CampusNode.ino`，选择你的 ESP32-S3 开发板并烧录。串口监视器设为 115200。
5. 首次启动看串口输出：SCD41/SHT31 被发现、SD 卡挂载成功、Wi-Fi 和时间同步成功后，就会开始缓存和上传。

使用 16 GB 卡足够存储很长时间的 1 分钟记录。队列到达 10 GB 前，上传失败保留原记录；到达容量上限会按下方规则清理最旧数据。若 SD 未挂载，固件每 30 秒重试；期间读数没有保存，上传暂停，串口会明确提示。卡上已有记录不会因挂载失败而主动删除。

### SD 容量清理与旧队列迁移

容量按本程序队列文件的实际字节数统计，10 GB = 10,000,000,000 字节，5.5 GB = 5,500,000,000 字节。达到上限时，从最旧文件开始释放至少约 5.5 GB，清理后通常剩约 4.5 GB。以完整分段删除，因此可能多清理不到一个 64 MiB 分段；不删除卡上其他文件，也不影响网站已经收妥的数据。清理目标写入 SD，若中途断电，重新挂载后会继续完成原目标。

这是待上传队列，上传确认后会释放已处理文件，不是永久历史档案。只有严重断网积压时才可能达到 10 GB。容量上限是兜底规则，触发时尚未上传的旧数据也可能被清掉；串口会报告清理情况。

旧版 `/queue.ndjson` 会自动重命名迁移到新队列的最旧分段，保留原记录 ID 和采集时刻。使用 Arduino IDE 时，新增的 `SdRecordQueue.h` 必须与 `CampusNode.ino` 放在同一目录。

### 弱网与时间

固件发小批量 JSON，适合 3–20 kb/s 的链路。HTTPS 握手本身会有固定开销，所以它不会对每个传感器的 5 秒内部更新都单独上传，而是每分钟取一次样，再分批发送。

在线并完成 NTP 校时后，记录包含真实 UTC 时间，离线补传仍保留原采集时刻。若断网前已经校时，ESP32 会继续使用本地时钟；如果设备在完全离线时重新上电，记录先以设备运行时间和本地顺序缓存，服务器只能在补传时以接收时间兜底，不能还原断网期间的真实时刻。数据档案将此类记录标为“接收时间 · 采集未校时”，正常记录则分别显示采集时间和服务器接收时间（UTC+8，精确到秒）。

当前固件使用普通 SSID/密码接入；如果校园网络需要网页认证、WPA2-Enterprise 或设备白名单，还需另外适配登录方式。

## API

- `GET /api/health`：服务、数据库和设备密钥配置状态
- `POST /api/device/handshake`：带设备 Bearer 密钥确认服务器可用性，保存设备状态；成功返回 204，不写入测量记录
- `GET /api/devices`：公开按设备返回最近成功握手、最后上传、状态快照、记录数与 `online/expired/unknown` 握手状态；包括只有握手、尚无读数的设备
- `GET /api/readings?location=M1&hours=24`：公开读取最新值和 1、6、24 小时或 7 天历史聚合数据
- `GET /api/records?location=M1&limit=100`：公开逐条读取原始记录，支持 1–500 条游标分页
- `POST /api/readings`：需要设备 Bearer 密钥；每次 1–25 条，单批最多 48 KB

握手正文示例（布尔值应为 JSON 布尔类型）：

```json
{"device_id":"esp32s3-m1","location_id":"M1","firmware_version":"2026.10.15-device-handshake","uptime_ms":12000,"sd_ready":false,"scd_ready":true,"sht_ready":false,"clock_ready":true}
```

`device_id`、`location_id` 必填，其他状态字段可省略；省略的字段显示未知。握手时间取服务器接收时间，设备不能自行回填；未通过设备密钥验证的请求不改变已登记设备状态。`GET /api/devices` 返回的 `serverTime` 与 `handshakeTimeoutMs` 用于前端按服务器时钟判断超时，不依赖访问者电脑的时区或时间设置。硬件状态是最后一次成功握手时的快照。

`/api/readings` 面向图表：所选时段不超过 480 个样本时返回原始时间点；样本更多时，根据实际覆盖时间选择整数时间桶计算平均值，保留各桶的 `sample_count`。响应中的 `aggregation.mode` 为 `raw` 或 `mean`，`aggregation.bucketSeconds` 为实际桶宽，`rangeSampleCount` 为所选时段样本总数。温度、湿度和 CO₂ 图表共用自适应时间轴：有效观测只覆盖短时段时自动放大，刻度细化到分钟或秒，并注明实际显示范围；点之间仍按真实时间间隔排列。

`/api/records` 返回数据库中的原始单条记录，默认按采集时间从新到旧排序。分页时把响应中的 `page.nextCursor` 原样带到下一次请求的 `cursor` 参数，直到 `page.hasMore` 为 `false`。例如：

```js
const base = "https://map.georgehan0514.top/api/records";
let cursor;
const allRecords = [];

do {
  const url = new URL(base);
  url.searchParams.set("location", "M1");
  url.searchParams.set("limit", "100");
  if (cursor) url.searchParams.set("cursor", cursor);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);
  const page = await response.json();
  allRecords.push(...page.records);
  cursor = page.page.hasMore ? page.page.nextCursor : null;
} while (cursor);

console.log(`Fetched ${allRecords.length} raw records`);
```

两个读取接口都公开并允许浏览器跨域访问；写入接口仍须设备 Bearer 密钥。读数会按稳定 `record_id` 去重。服务器限制批次大小、字段格式和数值范围。网页仅展示观察数据；CO₂ 是通风变化线索，不独立代表空气质量或健康结论。

## 数据备份与密钥轮换

- 数据在名为 `campus_atlas_data` 的 Docker 卷内，需纳入服务器例行备份。
- 设备密钥只在服务器 `.env` 与烧录到设备的本地 `firmware/CampusNode/secrets.h` 中保存；如果怀疑密钥泄漏，在服务器 `.env` 生成新值并重启容器，然后将新密钥写入固件重新烧录。
- Cloudflare 边缘 HTTPS 证书由 Cloudflare 管理；项目不保存该证书的私钥。Tunnel Token 和设备密钥都保存在 `.env`，只供服务器 Compose 使用，应以受限权限单独备份。Tunnel Token 泄漏时在 Cloudflare 刷新 Tunnel Token，并同步更新 `.env` 后重启 cloudflared。

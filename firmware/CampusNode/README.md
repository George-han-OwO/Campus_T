# ESP32-S3 节点烧录

本目录的 Arduino 固件适配 SCD41 + SHT31 + SPI MicroSD。完整接线、电源和服务器说明见项目根目录 `README.md`。

1. 安装 Arduino IDE 的 ESP32-S3 开发板支持。
2. 从 Arduino Library Manager 安装 `Sensirion I2C SCD4x`、`Adafruit SHT31`。
3. 在 `CampusNode` 草图目录中，把 `secrets.example.h` 复制为 `secrets.h`，填入两组 Wi-Fi、HTTPS API URL 和设备 Bearer 密钥。`API_URL` 必须是 `https://map.georgehan0514.top/api/readings`；`DEVICE_API_TOKEN` 必须与正在运行的服务器一致，不能保留 `PASTE_DEVICE_API_TOKEN_HERE`。这个文件必须与 `CampusNode.ino`、`trust_anchor.h` 放在同一目录。真实 Wi-Fi 密码和设备密钥不要提交或放入部署压缩包。
4. 确认 `SdRecordQueue.h`、`trust_anchor.h` 和 `secrets.h` 与 `CampusNode.ino` 在同一文件夹；选择 `ESP32S3 Dev Module`（或与实际 N16R8 板卡对应的配置），上传 `CampusNode.ino`。
5. 串口监视器选 115200。新版启动时应显示 `Firmware: 2026.10.15-device-handshake`。等待 SCD41 启动、SD 挂载、Wi-Fi 和 NTP 校时。

本版握手携带 `DEVICE_ID`、`LOCATION_ID`、固件版本、运行时间及 SD/传感器/校时状态。每台设备使用唯一编号，网站按该编号显示独立握手卡片。SD 故障时仍可成功握手并报告 SD 不可用；数据上传继续受 SD 就绪条件保护。网站以最近成功握手 5 分钟内为在线，测量上传另行显示。需要先更新服务器再烧录；旧服务器返回 204 并不代表已支持设备状态持久化。

启动时先尝试第一组 Wi-Fi，每次最多等待 12 秒，失败 5 次后切到第二组；第二组也失败 5 次后会回到第一组继续轮询。Wi-Fi 连接后请求 NTP 校时，未成功时每 60 秒重试一次；校时成功后，先向网站发送带设备密钥的 HTTPS 握手。确认成功后才上传 SD 队列，以后每 120 秒重新握手。网络中途断开后重新连接，也会先握手再补传。握手失败时仍继续采样并写入 SD。请先部署含 `/api/device/handshake` 的服务器版本，再烧录此固件。

串口正常顺序为 `NTP time sync requested` → `System time synchronized` → `Website handshake confirmed` → `Uploaded and acknowledged ... record(s)`。如果持续只有第一条，说明虽然连上了 Wi-Fi，但设备还没取得可信时间；检查该网络能否访问 NTP（UDP 123）、是否需要网页认证，也可用获准使用的其他 2.4 GHz 网络排查。若校时成功而握手显示 `connection refused`，先确认 `secrets.h` 的 `API_URL` 已改成正式域名；若返回 HTTP 404，先更新服务器；HTTP 401 则核对设备密钥。`SHT31 nan` 只表示可选的 SHT31 没有读数；未接该模块时 SCD41 的温湿度仍可使用。

`trust_anchor.h` 内含 ISRG Root X1 与 GTS Root R4 两个公开根证书。后者是当前 Cloudflare 边缘证书链使用的根；如 Cloudflare 后续更换签发 CA，需要重新确认信任根。

每 60 秒采样并写入 SD 后立即安排上传；服务器确认一批后，有积压则约 1 秒后继续补传，不再每批额外等待 30 秒。实际到达网站的时间仍取决于 Wi-Fi、校时、握手和请求耗时。串口会打印每次采集的 UTC 时间和设备运行时间；离线重启尚未校时时明确打印采集时间未知。重试和补传保留原来的采集时刻，不会改成上传时刻。

新队列在 `/atlas-queue/` 中按编号分段，每段最多 64 MiB，兼容 FAT32；用持久化游标记录服务器已确认的位置，避免补传大队列时反复复制剩余文件。旧版 `/queue.ndjson` 自动迁移，原数据与记录 ID 保留。

队列达到 **10 GB（10,000,000,000 字节）**时，按最旧优先删除至少约 **5.5 GB（5,500,000,000 字节）**。以完整分段清理，最多多清理不到 64 MiB；可能删除尚未上传的旧记录。清理目标持久化，中断后会继续；只清理由本程序管理的编号分段，卡上其他文件和网站数据库不受影响。SD 用作待上传缓存，已确认上传的分段平时也会释放，因此正常联网时不会持续累积到 10 GB。

如果 SHT31 没有识别，固件继续使用 SCD41 自带温湿度值。SHT31 默认探测 0x44，也尝试 0x45。MicroSD 以 1 MHz SPI 启动，开机最多尝试 3 次，此后若仍未挂载，每 30 秒重试。若持续失败，断电后检查 SD VCC 是否稳定接 5V、GND 是否与 ESP32 共地，CS/MOSI/MISO/SCK 是否分别接 GPIO 10/11/13/12，以及杜邦线和卡座接触。未挂载期间串口会明确提示读数未保存；SD 恢复后，卡上原有队列会继续补传。

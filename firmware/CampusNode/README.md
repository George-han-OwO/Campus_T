# ESP32-S3 直接上传固件

本目录使用 SCD41，可选接入 SHT31；不需要 MicroSD 模块或 SPI 接线。每 60 秒采样一次，联网、校时和握手成功后立即通过 HTTPS 上传当前读数。

## 烧录

1. Arduino IDE 安装 ESP32-S3 开发板支持，以及 `Sensirion I2C SCD4x`、`Adafruit SHT31` 库。
2. 保留现有 `secrets.h`。首次使用时将 `secrets.example.h` 复制为 `secrets.h`，填写 Wi-Fi、`https://map.georgehan0514.top/api/readings` 和服务器设备密钥。
3. 将 `CampusNode.ino`、`RamRecordQueue.h`、`trust_anchor.h`、`secrets.h` 放在同一个 `CampusNode` 文件夹。选择实际 ESP32-S3 板卡和端口，编译、上传。
4. 串口监视器设为 115200，启动版本应为 `2026.10.15-direct-upload`。

保持原传感器接线：SDA=GPIO5，SCL=GPIO4，GND 共地；供电沿用模块支持的原接法。断电后可拆掉 SD 模块。本版不读取、删除或补传旧卡文件；需要旧数据时保留卡并单独取回。

## 上传行为

- 每次采样后立即安排上传，不等凑够 10/20/30 条；单条也会发送。实际延迟受校时、握手、网络和 HTTPS 请求耗时影响。
- 服务器确认后才移除对应待发记录。上传失败时最多暂存最近 30 条在 RAM；重试保留原采集时刻与 record_id，服务器可安全去重。
- 有积压时每批最多 20 条，确认后约 1 秒继续发送剩余记录，不刻意保留最新 10 条。
- 队列已满再采样时，丢弃最旧未确认记录以保留新读数。复位、断电、重新烧录会清空 RAM 待发数据；服务器已确认的数据不受影响。
- 开机先尝试第一组 Wi-Fi 5 次，再尝试第二组，持续轮询。联网后进行 NTP 校时，成功后身份握手，每 120 秒重新握手。
- 握手上报设备身份、版本、运行时间和传感器/校时状态，不再上报 SD。设备编号、历史点位 M1 与 M104 显示关联保持不变。

正常日志：

```text
Firmware: 2026.10.15-direct-upload
Direct HTTPS upload enabled; RAM retry queue capacity 30; no SD required.
System time synchronized.
Website handshake confirmed.
Direct upload scheduled; RAM pending 1/30.
Uploaded and acknowledged 1 record(s); 0 pending in RAM.
```

启动未校时时的首次采样可能早于校时日志，采集时间为 null，不能事后伪造。若持续等待 NTP，检查校园网校时访问；HTTP 401 核对服务器设备密钥。密钥不贴到聊天、仓库或发布包。

`trust_anchor.h` 保留 TLS 根证书校验。SHT31 未连接或读数无效时使用 SCD41 自带温湿度，不影响直接上传。
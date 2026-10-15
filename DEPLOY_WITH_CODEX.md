# 没有公网 IP 时：Cloudflare Tunnel 保姆级部署指南

**当前状态更新：**2026-10-14 网站、健康接口和设备握手接口已通过公网访问检查。请优先按 [DEPLOY_WINDOWS_TUNNEL.md](./DEPLOY_WINDOWS_TUNNEL.md) 了解当前 Windows Tunnel 方式；本文件下述双容器步骤仅作为其他部署环境的参考。当前待处理的是本机 ESP32 密钥与正在运行的服务器不一致。

本项目现在按“服务器没有公网 IP”的情况部署。使用命名的 Cloudflare Tunnel 后，服务器主动连接 Cloudflare，网站访客再经 Cloudflare 到达服务器；不需要给服务器配置公网 IP，也不需要路由器转发或开放公网入站端口。

**Tunnel 的前提：**服务器能主动访问互联网，并允许 cloudflared 出站连接 Cloudflare。若服务器不能出站联网，Tunnel 也无法连接；需要先让托管商提供出站网络或另找可联网服务器。

## 目标和注意事项

- 主域名：georgehan0514.top
- 网站子域名：map.georgehan0514.top
- 网站：https://map.georgehan0514.top/
- 设备接口：https://map.georgehan0514.top/api/readings
- 健康检查：https://map.georgehan0514.top/api/health
- Cloudflare Tunnel 公开主机名的源站地址：HTTP 服务 atlas:3000。cloudflared 和 atlas 在同一个 Docker Compose 网络中，服务名 atlas 可直接解析。
- Compose 不把 3000 端口发布到主机；Tunnel 容器也不需要主机入站端口。
- Cloudflare Tunnel 与 DNS 区域必须属于同一 Cloudflare 账号。Tunnel 公共主机名会使用指向 tunnel UUID 的 CNAME，不要创建指向某个猜测 IP 的 A 记录。
- 本机固件已上传过旧配置；`secrets.h` 的 HTTPS API URL 已改为正式域名，设备密钥还需与当前服务器同步，然后重新烧录。
- 当前固件内置 ISRG Root X1 和 GTS Root R4。经 Tunnel 时 ESP32 连接的是 Cloudflare 边缘 HTTPS 证书；2026-10-14 检查时网站证书链使用 GTS Root R4。Cloudflare 以后可能更换签发 CA，届时需重新核对实际证书链并更新固件信任根；绝不允许通过关闭 TLS 校验规避。
- .env、Tunnel Token、DEVICE_API_TOKEN、Wi-Fi 密码和私钥都是秘密，绝不写入压缩包或提交记录，绝不打印到聊天、日志、截图或最终报告。

## 第一步：用户在 Cloudflare 控制台操作

### A. 确认主域名已注册并接入 Cloudflare

1. 用户已确认主域名为 georgehan0514.top，Cloudflare 账户中已有该域名区域。点开该区域，确认状态为 Active。
2. 不用重复添加域名，也不要将 map.georgehan0514.top 添加为独立区域；map 是已有主域名下的子域名。
3. 检查 Cloudflare 导入的已有 DNS 记录。若该域名已有邮箱或网站，保留原有 MX、TXT、A、CNAME 等记录。
4. Cloudflare 会分配两条 Nameserver。去域名注册商处把主域名 Nameserver 更新为 Cloudflare 提供的这两条，并等待 Cloudflare 区域状态显示 Active。若域名本身就在 Cloudflare 注册，一般不需要另改 Nameserver。

### B. 创建命名 Tunnel

1. 在 Cloudflare 左侧菜单进入 联网 / Networking → Tunnels。
2. 选择创建 Tunnel，连接器选择 Cloudflared，名称填 campus-living-atlas。
3. 选择 Docker 安装方式，查看 Cloudflare 显示的安装命令。命令里有一段很长的 Tunnel Token。不要把完整命令或 Token 发到聊天。
4. 先保留该页面。稍后将 Token 通过安全的服务器远程桌面会话直接写入服务器项目目录的 .env。不要把 Tunnel Token 贴给服务器 Codex，也不要传到 Git 或部署压缩包。

### C. 添加 Public Hostname

在刚建好的 Tunnel 中打开 Routes → Add route → Published application（旧界面可能显示 Public Hostnames），添加：

| 字段 | 填写内容 |
|---|---|
| Subdomain | map |
| Domain | georgehan0514.top |
| Type | HTTP |
| URL / Service | atlas:3000（若表单要求完整 URL，则填 http://atlas:3000） |

保存后，检查 Cloudflare 是否自动生成 map 的 CNAME，目标为该 Tunnel 的 UUID.cfargotunnel.com。隧道 CNAME 应由 Cloudflare 代理（橙云）；这不是公网服务器 IP。Cloudflare 文档说明 Tunnel 使用 CNAME 指向 UUID.cfargotunnel.com，并通过代理转发到 Tunnel。

### D. 放行服务器的出站网络

不需要配置服务器公网 IP、不需要家用路由器端口转发、不需要允许公网入站 TCP 80/443。若服务器有严格的出站防火墙，需要允许 cloudflared 向 Cloudflare 的 Tunnel 网络 TCP 或 UDP 7844 出站；cloudflared 默认优先使用 QUIC/UDP，也可在受限网络使用 HTTP/2/TCP。Docker 拉镜像和构建应用还需要服务器能连接 Docker Hub、npm registry 等站点。

Cloudflare 官方操作说明：

- [在控制台创建 Tunnel 并添加应用路由](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/)
- [Cloudflare Tunnel DNS 记录](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/)
- [Tunnel 防火墙和出站端口](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/)
- [Cloudflare Universal SSL 的 CA 说明](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/)

## 第二步：把下面任务交给服务器 Codex

先把部署 ZIP 上传到服务器，再将 ZIP 的实际完整路径填入下文方括号。若用户还没完成第一步的 Cloudflare 操作，Codex 只执行阶段 A 并暂停。

> 请用中文部署这个校园环境监测网站。先完整阅读当前目录的 README.md 与 DEPLOY_WITH_CODEX.md。目标域名是 map.georgehan0514.top，部署目录是 D:\services\campus-living-atlas。部署包完整路径是：[填写上传到服务器的 ZIP 完整路径]。
>
> 安全边界：绝对不要在 C:\Windows\System32 或 Windows 系统目录操作。只在 D:\services\campus-living-atlas 这个项目目录操作。不得覆盖已有项目目录、停止或修改 IIS、其他网站、反向代理、Docker 容器、Docker 卷或防火墙规则。不得开放主机入站 3000、80 或 443 端口。不得使用模拟读数填正式数据库。
>
> 不得读取后输出 .env、secrets.h 或任何密钥内容。不要在聊天、命令回显、日志、截图或最终报告里输出 DEVICE_API_TOKEN、TUNNEL_TOKEN、Wi-Fi 密码、证书私钥。可在内存中检查秘密文件的字段是否齐全、是否为占位值，但只能输出检查状态；不得输出字段值。不要把 Tunnel Token 放进命令行参数、聊天或代码仓库。
>
> 阶段 A：只检查服务器和解压，不启动服务。
>
> 1. 报告 Windows 版本、当前目录、Docker 是否可用、Docker Compose 版本，以及 docker info --format '{{.OSType}}' 的结果。本项目使用 Linux 容器；若当前 Docker 不能运行 Linux 容器，不要擅自安装、切换或重启 Docker，先停下并报告。
> 2. 本项目的 Compose 不将任何容器端口映射到服务器主机，所以不需要检查或占用 80、443、3000，也不应新增公网入站防火墙规则。不要停止或改动已有 Web 服务。
> 3. 确认 ZIP 存在且非空。若目标目录已存在且非空，不覆盖、不删除；改为报告冲突并暂停。否则创建目标目录并解压。
> 4. 确认解压目录根部直接包含 docker-compose.yml、Dockerfile、README.md、DEPLOY_WITH_CODEX.md、scripts\init-env.mjs、server\index.js、src 和 firmware。不要多套一层文件夹，也不要解压到 System32。
> 5. 确认压缩包没有 .env 和 firmware\CampusNode\secrets.h；这是正确状态。
> 6. 在这里暂停。告诉我部署目录、Docker/Linux 容器检查结果、当前环境是否有出站互联网、出站防火墙是否限制 TCP/UDP 7844，以及我还需在 Cloudflare 控制台完成什么。不要生成虚构 Tunnel Token 或先运行容器。
>
> 阶段 B：Cloudflare Tunnel 创建后，先按以下顺序准备 .env、填入 Token，再启动服务。应用路由可以在连接器上线后添加。
>
> 1. 先检查 .env 是否存在，不显示内容。如果不存在，运行 node scripts/init-env.mjs map.georgehan0514.top 生成文件和随机 DEVICE_API_TOKEN。若服务器没有 Node，可使用 node:22-bookworm-slim 容器挂载当前目录运行脚本；不要为此在系统目录安装依赖。如果 .env 已存在，保留现有密钥，仅检查所需字段是否存在及是否仍为占位值，报告布尔状态而不显示值；不要覆盖或重新生成有效密钥。
> 2. 告诉我 .env 的完整路径，并暂停，让我在服务器的安全远程桌面会话中将 Cloudflare Tunnel Token 加到该文件，变量名为 TUNNEL_TOKEN。不要让我把 Token 粘贴到 Codex 对话。等我明确确认已经保存后再继续。
> 3. 用 icacls 检查 .env 权限；尽量限制为部署账号、SYSTEM 和 Administrators。若无法保证秘密文件访问权限，先报告，不要运行容器。
> 4. 运行 docker compose config --quiet。不要运行会展开并打印环境变量的配置命令。验证通过后，在当前项目目录运行 docker compose up -d --build。
> 5. 用 docker compose ps 检查 atlas 为 healthy，cloudflared 正常运行。只需查看必要日志尾部；分享或汇报前确认日志里没有任何 Token。连接器上线后，让用户在 Cloudflare 配置 map.georgehan0514.top → http://atlas:3000 的 Published application 路由；路由保存后再执行下面的公网访问检查。
> 6. 浏览器/API 验证：https://map.georgehan0514.top/api/health 成功；公开 GET https://map.georgehan0514.top/api/readings?location=M1&hours=24 正常返回（刚部署时无记录是正常的）；未提供 Authorization Bearer 密钥的 POST /api/readings 与 POST /api/device/handshake 必须返回 401。不要将测试数据写入正式数据库。先部署服务器握手接口，再烧录新版固件。
> 7. 在 Cloudflare 控制台确认 Tunnel 显示 Healthy / Connected，Public Hostname 指向 http://atlas:3000，DNS 中 map 是指向 UUID.cfargotunnel.com 的 CNAME。确认 Docker Compose 没有把 3000 端口映射到主机。
> 8. 汇报网站 URL、项目路径、atlas/cloudflared 状态、Tunnel 健康状态、健康检查结果、SQLite 持久卷名称和备份建议。不得汇报或显示任何密钥。

## 第三步：服务器部署后配置 ESP32

服务器 Codex 生成的 DEVICE_API_TOKEN 和 Cloudflare Tunnel Token 用途不同：

- DEVICE_API_TOKEN 用于固件上传 API。你需要通过安全方式在服务器本机查看 .env 中这一项，再写入本机 firmware/CampusNode/secrets.h。不要贴到对话里。
- TUNNEL_TOKEN 只给 cloudflared 容器连接 Cloudflare 使用，不要写进 ESP32 固件。
- 本机 secrets.h 的 API_URL 设为 https://map.georgehan0514.top/api/readings；保留已配置的 Wi-Fi 和点位编号，然后重新编译、烧录。

注意：Tunnel 发布后先用浏览器打开网站验证，再用设备串口检查 TLS 和上传结果。若设备报证书错误，说明当前 Cloudflare 边缘证书 CA 不在固件信任范围内。先读取 Cloudflare 实际证书链并安全调整固件信任 CA；不要使用 setInsecure、不要关闭 TLS 校验。设备 CA 适配完成前，网站可以公开访问，但 ESP32 可能无法上传。

## 常见问题

- Cloudflare 1006/1016 或网站打不开：检查 Tunnel 是否运行、是否 Connected、Public Hostname 拼写、DNS 是否为此 Tunnel 的 CNAME、源站 URL 是否为 http://atlas:3000。不要改成服务器公网 IP。
- Tunnel 一直离线：检查服务器是否能主动访问互联网，TCP/UDP 7844 是否出站放通，cloudflared 容器状态和日志。不要开放公网入站端口来“修复”Tunnel。
- 网站可打开但 API 401：网页 GET 是公开的；设备 POST 必须带 DEVICE_API_TOKEN。请在设备配置中检查 URL/token 是否与服务器匹配，不要把 Token 发进聊天。
- 网站可打开但 ESP32 证书失败：这是边缘 CA 信任链问题，按上面的 TLS 说明处理；绝不禁用校验。

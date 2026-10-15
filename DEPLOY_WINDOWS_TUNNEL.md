# 当前配置：Windows 主机上的 MSA-SC Tunnel

2026-10-14 实测 `https://map.georgehan0514.top/` 与 `/api/health` 均返回 HTTP 200，健康接口报告数据库就绪、设备写入密钥已配置；`POST /api/device/handshake` 未带密钥时返回 401。网站目前可访问。尚未验证 Windows 连接器是否配置开机自启。

历史排查中，设备曾因 `API_URL` 使用示例域名、或 `DEVICE_API_TOKEN` 保留示例占位值而无法握手。当前配置请以设备正在烧录的 `secrets.h` 和服务器现有 `.env` 为准：地址应为正式域名，两端设备密钥必须一致。若返回 401，将**正在运行的服务器**使用的 `DEVICE_API_TOKEN` 安全复制到本机 `secrets.h`，保存后重烧录。不要重置有效服务器密钥，也不要在聊天或日志中显示密钥。

本说明优先于 DEPLOY_WITH_CODEX.md 中的双容器部署方式。复用现有 Windows cloudflared，不重复启动 Docker cloudflared。网站目标为 https://map.georgehan0514.top，服务路由指向 http://127.0.0.1:3000。

## Cloudflare 表单

打开 MSA-SC → 路由 → 添加路由 → Published application（发布的应用程序）。子域名填 map；域名选择 georgehan0514.top；路径留空；服务地址填 http://127.0.0.1:3000。如果类型和地址分开，类型选 HTTP，地址填 127.0.0.1:3000。

保存后检查 map 的 DNS 路由是否指向这个 Tunnel。连接器健康与网站可访问是两件事；若网站未启动或端口未发布到本机回环地址，可能显示 502。

## 给服务器 Codex 的任务

将下面这段复制给服务器上的 Codex，并提供 ZIP 在服务器上的实际完整路径：

> 请用中文继续部署校园观测网站，目标域名 map.georgehan0514.top。Windows 主机上已有名为 MSA-SC 的健康 cloudflared 连接器。先阅读 DEPLOY_WINDOWS_TUNNEL.md 和 README.md，采用现有 Windows 连接器配置。
>
> 1. 检查当前服务器上的网站部署目录、现有运行进程、Docker Compose 项目和 3000 端口占用。如果项目已经部署，复用原目录、数据库卷和设备密钥；不要清空、覆盖用户数据或另建一个空数据库。若尚未部署，解压到 D:\services\campus-living-atlas；若 D 盘不存在，选择当前用户可写的独立项目目录并报告实际路径。不要在 System32 内部署。
> 2. 确认现有 cloudflared 是 Windows 服务还是前台进程；只报告状态与启动类型，不输出含 Token 的进程命令行或服务启动参数。现有服务应可在开机后自动启动；若当前只是临时前台进程，报告这个事实及需要转为服务的步骤，保护现有 Token。
> 3. 检查 Docker 是否能运行 Linux 容器。如果已有网站以原生 Node 方式运行，先检查其本机监听地址与健康接口，不要再启动第二份。若未部署且 Docker 无法运行 Linux 容器，报告实际环境和所缺依赖，不要执行不适用的 Compose 命令。
> 4. 使用 Docker 时，只选择 docker-compose.windows-tunnel.yml，不能和默认 docker-compose.yml 叠加。保留原 Compose 项目名与数据库卷；若此前没有部署，则使用部署目录默认项目名。这个文件只启动 atlas，并将端口映射到 Windows 本机 127.0.0.1:3000，不需要向外开放入站端口。
> 5. .env 不存在时运行 node scripts/init-env.mjs map.georgehan0514.top；已存在时保留有效 DEVICE_API_TOKEN，只在内存中检查字段并报告状态，不输出值。现有 Windows Tunnel 已管理连接凭据，这份单容器 Compose 不需要 TUNNEL_TOKEN。
> 6. 先运行 docker compose -f docker-compose.windows-tunnel.yml config --quiet，再运行 docker compose -f docker-compose.windows-tunnel.yml up -d --build。不要运行 docker compose down -v，不要停止其他项目的容器。若发现本项目之前已有 cloudflared 容器，也先报告其存在，避免留下未经确认的重复连接器。
> 7. 检查 atlas 健康状态及 http://127.0.0.1:3000/api/health。若 3000 被其他应用占用，不要结束该应用；报告可用替代端口，并同步说明需要修改的回环端口映射和 Cloudflare 服务地址。
> 8. 提醒用户在 Cloudflare 将 MSA-SC 的 Published application 路由设为 map.georgehan0514.top → http://127.0.0.1:3000。路由保存后检查 https://map.georgehan0514.top/api/health，以及公开读取接口；未携带设备密钥的 POST /api/readings 与 POST /api/device/handshake 均应返回 401。不向正式数据库写入虚构读数。先部署服务器握手接口，再提醒用户烧录新版固件。
> 9. 汇报实际项目目录、网站 URL、Docker/Node 运行方式、Windows cloudflared 是否开机自启、网站是否能在重启后恢复、健康接口结果及实际数据库卷名。未验证的项目标为未验证。不得输出 Wi-Fi 密码、设备密钥或 Tunnel Token。

## ESP32 后续配置

设备上传地址为 https://map.georgehan0514.top/api/readings。网站部署完成后，仍需把服务器 DEVICE_API_TOKEN 安全写入本机 secrets.h 并重新烧录；不要把 Tunnel Token 写进设备。固件现内置 ISRG Root X1 和 GTS Root R4；2026-10-14 检查时，实际 Cloudflare 边缘证书链使用 GTS Root R4。证书轮换后仍需核对实际证书链；不要关闭证书校验。

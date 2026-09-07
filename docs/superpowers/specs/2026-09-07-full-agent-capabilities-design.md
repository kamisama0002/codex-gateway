# 完整 Agent Runtime 与能力平台设计

## 1. 目标

把当前每用户一个长期 Docker 容器，从最小 Codex App Server 运行环境升级为可直接完成代码、
数据、文档、网页和业务 MCP 工作的通用 Agent 工作站，同时保持用户容器、工作区、配置和凭据
相互隔离。

本次交付覆盖以下全部能力：

| 优先级 | 能力 | 验收结果 |
| --- | --- | --- |
| P0 | MCP 配置 | 管理员可登记并授权 MCP；用户容器中的 `codex mcp list` 能看到已授权服务器，真实测试 MCP 可完成查询和写入 |
| P0 | 配置持久化 | 重启、Gateway 重建和镜像升级后，用户配置及平台下发配置仍存在，入口脚本不再覆盖整个 `config.toml` |
| P0 | 基础工具链 | Git、SSH、curl、jq、归档、编译器、Node、Python、数据库 CLI 等命令在容器中可直接运行 |
| P0 | 外网 | 容器可访问 DNS、HTTPS、GitHub、npm、pip 和远程 MCP，同时仍无宿主机网络、端口和 Docker Socket 权限 |
| P0 | Codex 升级 | 镜像与 Gateway 协议基准统一升级到 `0.153.4`，运行时 Schema 兼容性检查通过 |
| P1 | 业务 Skills | 管理员可登记、版本化、授权和撤销组织 Skill；授权用户容器可发现并使用 |
| P1 | Plugins / Apps | 管理员可登记 Marketplace/Plugin/App 并授权；运行时实际状态与期望状态可查看、重试和审计 |
| P1 | 浏览器 | Chromium、Playwright 和 Playwright MCP 在容器内可用，能完成真实网页打开与内容读取 smoke |
| P1 | Web 搜索 | 平台内置一个可工作的搜索 MCP，Agent 能搜索公网并读取结果；后续可替换为企业搜索源 |
| P1 | Memory | Codex Memory 功能启用并使用持久化 `CODEX_HOME`，容器重启后记忆数据仍存在 |
| P1 | 文档与数据 | PDF、Office、OCR、图片、音视频和 Python 数据分析工具可执行真实转换、识别与分析 smoke |
| P1 | 凭据系统 | MCP、Git、SSH、搜索及云平台凭据加密保存、按用户/项目授权、按有效期下发、轮换并审计 |

实际业务 MCP 的 URL、Tool Schema 和生产凭据尚未提供。本次实现完整的登记、授权、注入与测试
能力，并用本地真实 MCP fixture 验证查询和写入。拿到业务参数后只需管理员新增配置，无需改镜像。

## 2. 方案选择

采用“平台管理、容器执行”的混合方案：

- Runtime 镜像负责稳定、可复现、无租户数据的工具和浏览器环境。
- Gateway 负责能力目录、用户/项目授权、加密凭据、审计和期望状态。
- Runtime Manager 只接受 Gateway 已解析的容器规格，不接受浏览器传入镜像、网络、挂载或任意
  Docker 参数。
- Codex App Server 是 Skills、Plugins、Apps、MCP、Memory 和 Agent 执行的实际运行内核。

未采用的方案：

- 全部烤进镜像：制作快，但无法按用户授权，MCP 和密钥轮换需要重新构建镜像，也会扩大泄露面。
- 浏览器、配置和凭据全部拆 Sidecar：隔离边界更细，但第一版需要额外的网络协议、生命周期和
  故障恢复。当前浏览器放在用户容器内，搜索服务作为共享 Sidecar；能力和凭据接口保留以后拆分
  的边界。

该分层不依赖 Codex Thread DTO。以后增加 Agents SDK Runtime 时，可以复用能力目录、授权、
Secret、审计、搜索和 Runtime Manager，只新增运行时 Adapter。

## 3. 子系统与交付顺序

### 3.1 完整运行时镜像

升级 `docker/agent-runtime.Dockerfile`，保留命名构建阶段并提供 `full` 目标。正式测试使用 `full`
镜像别名。

镜像包含：

- 基础开发：Git、Git LFS、OpenSSH Client、GitHub CLI、curl、wget、jq、ripgrep、fd、rsync、
  patch、zip/unzip、tar、7zip、进程和网络诊断、SQLite、PostgreSQL/MySQL/Redis CLI。
- JavaScript：Node.js、npm、pnpm、Yarn、Bun、TypeScript、Playwright CLI、Playwright MCP。
- Python/data：Python 3、venv、pip、uv、编译头文件、NumPy、pandas、Polars、PyArrow、SciPy、
  scikit-learn、matplotlib、seaborn、HTTP/数据库客户端和 Jupyter 核心包。
- 编译语言：GCC/G++、Clang、CMake、Ninja、Go、Rust/Cargo、JDK、Maven、Gradle。
- 文档媒体：LibreOffice Headless、Pandoc、Poppler、Ghostscript、ImageMagick、FFmpeg、
  Tesseract 中英文 OCR，以及 PDF/Word/Excel/PowerPoint Python 库。
- 浏览器：Chromium、ChromiumDriver 和 Playwright Chromium 依赖。
- 容器工具：只安装 Docker CLI，不挂载宿主机 Docker Socket，也不启动 Docker Daemon。

Codex、Node 全局包、Python 包和浏览器版本固定在构建参数或锁文件中。镜像内写入版本清单，
Runtime Manager 的 `imageVersion` 由清单摘要生成，禁止用模糊 `latest` 判断升级。

### 3.2 配置所有权与持久化

`/codex-home` 和 `/workspace` 继续使用每用户独立持久卷。入口脚本遵守以下所有权：

- `/codex-home/config.toml` 是持久基础配置，只在文件不存在时创建，不再整文件覆盖。
- 模型 Provider、默认模型和平台强制 Feature 由受控 Node 启动器通过 App Server 正式支持的
  `-c` 和 `--enable` 参数注入。启动器使用参数数组，不经过 shell 拼接；Token 只使用环境变量
  引用，不写入 TOML 或命令参数。
- 平台管理的能力使用 `org__` 命名空间。Gateway Adapter 通过官方 App Server RPC 和受限文件
  API 只维护该命名空间，不修改用户自建 MCP、Skill 和 Plugin。
- 组织 Skill 写入 `/codex-home/skills/org__<id>/<version>/`，使用临时目录加原子替换；撤销授权只
  删除对应组织目录。
- MCP、Plugin 和 App 变更写入后调用官方 reload/list 接口确认实际状态。同步失败保留上一个可用
  配置，不以空配置覆盖。
- Memory 使用 Codex `0.153.4` 正式支持的 Feature 配置，数据库保存在 `/codex-home`；不自行
  创建平行记忆数据库。

### 3.3 能力目录、授权与同步

Gateway 新增 Runtime-neutral 能力域：

- `capability_definitions`：`skill | plugin | app | mcp | search`，含稳定 ID、版本、来源、配置模板、
  启用状态和敏感字段声明。
- `capability_assignments`：绑定用户或项目；项目授权只有该项目会话可见。
- `capability_syncs`：记录期望摘要、实际摘要、逐项结果、安全错误、时间和重试次数。
- `capability_artifacts`：保存组织 Skill/Plugin 元数据和内容摘要；大文件放受控持久目录，数据库只
  保存索引和校验值。

管理员界面提供 Skills、Plugins、Apps、MCP、Search 五个页签，支持登记、启停、授权、撤销和
手动同步。普通用户只能查看自己已授权能力及连接状态，不看到密钥、内部 URL 或安装参数。

每个用户 Runtime 启动、重启、镜像升级、授权变化和凭据轮换都会触发串行 Reconcile：

1. 读取用户与当前项目的期望能力。
2. 通过 Codex Adapter 读取 App Server 实际状态。
3. 生成确定性的增删改计划。
4. 一次执行一个操作并记录结果。
5. 重新读取实际状态；期望摘要和实际摘要一致才标记成功。

同步必须幂等。用户 A 的失败不能阻止用户 B，也不能修改用户 B 的容器或凭据。

### 3.4 MCP 与 Web 搜索

MCP 定义支持 STDIO 和 Streamable HTTP：

- STDIO 命令必须来自管理员登记的可执行程序与参数模板，浏览器不能提交任意命令。
- HTTP URL 必须为管理员登记的 HTTPS 或平台内部地址；凭据只通过声明的环境变量引用。
- Tool 的查询/写入分类由管理员登记并在审计中记录。业务服务仍需在 MCP 服务端再次校验权限和
  幂等键，Gateway 不猜测业务对象。

部署一个共享搜索 Sidecar，并提供标准 MCP `web_search`、`web_fetch` 工具。它连接普通外网网络
和内部 Agent 网络，不挂载用户工作区；请求包含用户短期令牌并执行限流、超时、响应大小限制和
审计。搜索后端首版使用自托管 SearXNG，Gateway 通过能力目录默认授权搜索 MCP。企业搜索或付费
搜索 API 以后只替换 Search Provider，不改变 Agent MCP 配置。

本地测试 MCP fixture 同时提供只读营业额查询和需要审批的写入 Tool，用来验证列表、调用、审批、
错误和审计全链路；fixture 不进入正式能力目录。

### 3.5 凭据系统

Gateway 使用现有 AES-GCM 基础设施新增通用 Secret Broker：

- 凭据类型：静态 Token、用户名/密码、SSH Private Key、OAuth Token、外部短期令牌签发器。
- 所有密文绑定 Capability ID、用户、项目和用途；数据库不保存明文，API 永不返回明文。
- 管理员可声明 Secret 映射到受控环境变量或 `/run/codex-secrets/<id>`，不能指定任意容器路径。
- Runtime Manager 通过已有 HMAC 请求接收一次性解析结果，在创建容器时注入；敏感值不进入日志、
  label、镜像、TOML、命令参数或浏览器 DTO。
- `/run/codex-secrets` 使用每容器 tmpfs。需要文件的 Git/SSH/云工具读取该目录，权限为 `0600`。
- 凭据有 `notBefore`、`expiresAt`、版本和撤销状态。轮换或接近过期时，Gateway 重新签发并安全
  Reconcile；只有环境变量无法热更新时才重建该用户容器，两个持久卷保持不变。
- MCP OAuth State 一次性、十分钟过期并绑定用户、Runtime 和 MCP；回调、刷新与撤销均审计。

宿主机管理员仍能通过 Docker 管理权限读取容器内存或环境，这是 Docker 信任边界。本设计防止
普通用户、其他容器、前端、日志和数据库明文获取凭据，不宣称防御宿主机 root。

### 3.6 网络、资源与安全

Runtime Manager 固定管理两个网络：

- `agent-runtime`：内部网络，承载 Gateway、Runtime Manager 与 App Server 通信。
- `agent-egress`：普通 bridge，仅提供 DNS 和主动出站访问，不发布任何 Agent 端口。

测试环境每个完整 Runtime：

- 内存上限 8 GiB、CPU 上限 4 核、PID 上限 1024。
- `/tmp` 为 2 GiB `nosuid,nodev` tmpfs，允许工具链执行临时文件。
- `/dev/shm` 为 1 GiB，供 Chromium 和 Python 多进程使用。

不变的安全边界：UID/GID `10001:10001`、只读根文件系统、`CapDrop: ALL`、
`no-new-privileges`、无 privileged、无 host network、无宿主目录、无 Docker Socket、无设备和
无公开端口。可写位置仅为 `/workspace`、`/codex-home`、`/tmp`、`/dev/shm`、
`/run/codex-secrets`。

直连外网允许 Agent 主动发送工作区内容，这是测试环境已经确认的产品选择。后续可在相同网络边界
增加域名代理和 DLP，不影响本次接口。

## 4. 错误处理与可观察性

- 镜像或 Schema 不兼容：Runtime 不进入 ready，显示版本、缺少能力和安全错误码。
- 单个 MCP/Plugin/Skill 同步失败：只标记该能力失败，保留其他已工作能力。
- 凭据缺失或过期：不启动对应能力，提示管理员或用户重新授权，不把 Secret 值写入错误。
- 搜索 Sidecar 不可用：搜索 Tool 返回可重试错误，不阻塞代码、文件和业务 MCP。
- Runtime 重建失败：原持久卷和旧容器在新容器健康前不删除；失败时可回到旧镜像。
- 所有配置写、授权、凭据轮换、MCP 写 Tool 审批和 Runtime 升级写入审计事件。

## 5. 上线与迁移

1. 在 CentOS 10 构建 `full-0.153.4` 镜像和搜索 Sidecar，不触碰现有三个长期 Agent。
2. 用临时用户、临时 Volume 和两个真实网络跑镜像 smoke。
3. 部署兼容新旧镜像的 Gateway 与 Runtime Manager；Runtime Manager 重启不重启 Agent。
4. 为一个测试用户升级镜像，验证 `/workspace`、`/codex-home`、Thread 和基础配置保留。
5. 登记并授权本地测试 MCP、搜索、Skill、Plugin/App，验证实际状态和凭据隔离。
6. 逐个升级剩余用户。每次只操作一个 Runtime，并在下一个用户前确认健康。
7. 新 Runtime 默认使用 `full` 别名；旧镜像保留到所有用户稳定后再决定清理。

## 6. 测试

### 单元与契约测试

- Docker 双网络、tmpfs、资源限制、无危险挂载和固定镜像别名。
- EntryPoint 保留基础配置、Provider 覆盖、Memory 开关和 Token 脱敏。
- 能力 CRUD、用户/项目授权、Reconcile 幂等性、跨用户隔离和失败恢复。
- Secret 加密、过期、撤销、OAuth State、防重放、受限环境变量/文件路径。
- App Server `generate-json-schema` 与 Gateway parser 的 `0.153.4` 兼容性。

### 容器 smoke

- 所有声明命令和关键版本。
- GitHub HTTPS、npm、pip、DNS 和任意公开 HTTPS。
- Chromium/Playwright 打开真实页面。
- PDF、Office、OCR、图片、音视频转换。
- Python 数据包导入并分析一份 CSV。
- `codex mcp list` 非空，测试 MCP 查询和审批写入成功。
- Web 搜索返回真实公网结果并能抓取结果页。
- 配置、Memory、Skill 和工作区在 stop/start 及镜像升级后保留。
- App Server 健康、真实模型 Turn、错误与审计输出不含凭据。

### 回归范围

运行 Runtime Manager、Provider、App Server Schema、MCP、审批、文件、Thread 和登录相关聚焦
测试，再在 CentOS 10 执行容器 E2E。镜像构建只执行一次并复用同一摘要，避免重复耗时构建。

## 7. 非目标

- 不硬编码尚未提供的生产业务 MCP 地址和密钥。
- 不给 Agent 宿主机 Docker、root、GPU、Kubernetes 或宿主文件系统权限。
- 不承诺任意第三方 Plugin/App 都可无审核安装；管理员必须先登记和授权。
- 不在本期实现完整 DLP、企业出站代理和跨区域 Secret Vault；接口为后续替换外部 Vault 保留。

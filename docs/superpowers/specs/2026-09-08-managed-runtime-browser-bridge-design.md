# Managed Runtime Browser Bridge Design

> 日期：2026-09-08
>
> 状态：已确认设计方向，等待书面规格复核

## 1. 背景

当前系统已经具备两套彼此独立的“浏览器”能力：

1. 每用户 Agent Runtime 中安装了 Chromium、ChromeDriver 和 `playwright-mcp`。系统能力 `org__browser` 已注入 Codex 配置，但它使用 `--headless` 自行启动浏览器。
2. Gateway 工作区的“浏览器”按钮实际是 Web Preview。它要求用户输入 URL，通过 Gateway 的 SSH TCP 代理读取远端 HTTP/HTTPS 服务，再嵌入 iframe；它没有连接用户 Runtime 中由 Playwright 控制的 Chromium。

因此 Codex 能后台操作网页，但用户无法从 Gateway 看到或操作同一个浏览器。用户和 Agent 也不能共享标签页、Cookie 和登录过程。

## 2. 目标

1. Gateway 现有“浏览器”按钮直接打开当前用户 Agent Runtime 中的真实 Chromium。
2. Codex App Server 通过 `playwright-mcp` 控制用户看到的同一个 Chromium 进程。
3. 用户和 Agent 默认都能操作浏览器，不增加接管、交还或互斥控制界面。
4. 浏览器登录态持久保存在现有 `/codex-home` 用户卷中。
5. 浏览器端口只在 Docker 内网暴露，浏览器客户端只能通过 Gateway 鉴权代理访问。
6. 前端只展示未启动、加载、已启动和启动失败，不增加标签页、登录态或浏览器任务管理页面。
7. 保留 Search MCP 和 SearXNG，浏览器能力不替代结构化公网搜索。

## 3. 非目标

- 不复用用户本地桌面 Chrome 的 Profile 或 Cookie。
- 不允许浏览器直接访问 Runtime Manager、Docker Socket 或 Codex App Server 凭据。
- 不在第一期增加“用户接管”“交还 Agent”或输入锁。
- 不实现 Android 模拟器、手机 App 扫码自动确认或 Passkey 自动化。
- 不移除 Search MCP、SearXNG 或现有 MCP 能力管理。
- 不把浏览器 Profile 暴露到 Gateway 文件管理器。
- 不为浏览器增加独立数据库、独立用户卷或新的长期凭据格式。

## 4. 方案选择

采用“同一 Chromium + CDP + noVNC”方案：

```text
Gateway Browser Panel
        |
        | authenticated HTTP/WebSocket proxy
        v
Agent Runtime authenticated browser proxy :6080
        |
        v
noVNC/websockify :6081 (loopback) -> Xvfb + Chromium
        ^
        | CDP 127.0.0.1:9222
        |
playwright-mcp <- Codex App Server
```

不采用 Gateway 自行实现 CDP Canvas/Screencast。noVNC 已处理键鼠、剪贴板、分辨率和 WebSocket 传输，第一期只需把它安全嵌入现有 Browser Panel。

不继续让 `playwright-mcp`自行创建 headless Chromium。独立浏览器会导致用户看到的页面与 Agent 操作的页面分离，并可能同时锁定同一个 Profile。

## 5. Agent Runtime

### 5.1 浏览器进程

完整 Agent Runtime 镜像增加：

- Xvfb，显示号固定为 `:99`。
- 轻量窗口管理器，用于稳定窗口尺寸和浏览器最大化。
- x11vnc，仅监听容器回环接口。
- noVNC 与 websockify，仅监听容器回环端口 `6081`。
- Runtime browser proxy，对共享 Runtime 内网暴露鉴权端口 `6080/tcp`。

Runtime 启动时同时启动以下长期进程：

1. Xvfb。
2. 窗口管理器。
3. Chromium。
4. x11vnc/websockify/noVNC。
5. Runtime browser proxy。
6. Codex App Server。

为了保持第一期控制面简单，浏览器随用户 Runtime 启动，不单独引入浏览器守护 API。前端的“未启动”表示用户 Runtime 不存在或已停止；“启动失败”表示 Runtime 已启动但浏览器就绪检查失败。

### 5.2 Chromium

Chromium 使用：

```text
DISPLAY=:99
--remote-debugging-address=127.0.0.1
--remote-debugging-port=9222
--user-data-dir=/codex-home/browser-profile
--no-sandbox
```

Profile 固定为：

```text
/codex-home/browser-profile
```

它自然落入现有用户 `codex-home-*` Docker named volume，不新增挂载。目录权限为 `0700`，所有者保持 `10001:10001`。

### 5.3 Playwright MCP

系统能力 `org__browser` 改为连接现有 Chromium：

```text
playwright-mcp
--cdp-endpoint http://127.0.0.1:9222
--output-dir /workspace/.agent/browser
--caps vision,pdf
```

移除 `--headless`、`--executable-path` 和 `--user-data-dir`，防止 MCP 创建第二个浏览器进程。Playwright MCP 0.0.80 已支持 `--cdp-endpoint`。

### 5.4 进程监督和健康

Runtime 入口使用一个 Node.js supervisor 管理浏览器进程和 Codex App Server，避免 shell 后台进程成为孤儿。supervisor 负责：

- 按依赖顺序启动浏览器组件。
- 等待 CDP `/json/version` 和 noVNC HTTP 入口就绪。
- 将 SIGINT/SIGTERM 转发给全部子进程并清理僵尸进程。
- 浏览器启动失败时保留 Codex App Server，避免浏览器故障导致聊天完全不可用。
- 浏览器组件异常退出后按 1、2、5、10 秒退避持续重启；退避上限保持 10 秒，不清除 Profile。
- 输出稳定、无敏感信息的启动错误码。

现有 Runtime 健康检查继续以 Codex App Server 为主；新增独立浏览器就绪结果，不把浏览器故障等同于整个 Runtime 不健康。

## 6. Runtime Manager

### 6.1 Runtime endpoint

`ManagedRuntimeEndpoint` 在现有 App Server WebSocket 地址之外增加浏览器内网地址：

```ts
type ManagedRuntimeEndpoint = {
  websocketUrl: string;
  browserUrl?: string;
};
```

托管 Runtime 的地址固定使用容器 DNS 名和内部端口，例如：

```text
ws://codex-runtime-<id>:4500
http://codex-runtime-<id>:6080
```

两者都不发布宿主机端口。

### 6.2 状态

Runtime Manager 提供经过现有 HMAC 请求认证的浏览器状态读取：

```text
GET /v1/runtimes/{runtimeId}/browser
```

返回：

```json
{
  "runtimeId": "runtime-id",
  "status": "running",
  "browser": "ready"
}
```

`browser` 只允许 `not_started`、`starting`、`ready`、`failed`。第一期不增加独立 start/stop browser 接口。Gateway 使用现有 Runtime start/provision 流程启动整个 Runtime，然后读取浏览器状态。

### 6.3 Docker 安全边界

- Runtime 继续使用非 root 用户 `10001:10001`。
- 保持只读根文件系统、`CapDrop=ALL`、`no-new-privileges` 和非 privileged。
- `6080/tcp` 只声明为容器内部端口，不创建宿主机 PortBindings。
- CDP `9222` 只绑定 `127.0.0.1`，Gateway 不能直接调用 CDP。
- x11vnc、websockify 和 noVNC upstream 只绑定回环接口。
- 对 Runtime 内网开放的 `6080` browser proxy 必须验证现有 Runtime capability token。它只保存 `CODEX_REMOTE_TOKEN_SHA256`，对每个 HTTP 请求和 WebSocket upgrade 的 Bearer token 做恒定时间摘要比较。
- Gateway server 在代理到 Runtime 时注入 Runtime token；浏览器 iframe、URL、Cookie、Realtime 消息和日志均不包含该 token。
- 其他用户 Runtime 即使能解析目标容器 DNS，也无法通过 browser proxy 鉴权。
- 浏览器 Profile 不写入 `/workspace`，避免被文件下载、上传和项目共享功能读取。

## 7. Gateway server

### 7.1 浏览器会话类型

现有 Browser Preview 会话增加明确的目标类型：

```ts
type BrowserTarget =
  | { type: "runtime"; runtimeId: string }
  | { type: "url"; hostId: number; targetUrl: string };
```

`runtime` 类型通过当前登录用户映射到其托管 Runtime，目标地址只能来自 Runtime Manager 的受信结果；浏览器不能提交任意容器名、IP 或端口。

`url` 类型保留现有 SSH Web Preview 能力，但不作为托管 Runtime 的默认“浏览器”入口。

### 7.2 代理

Gateway 复用现有 Browser Preview 的以下能力：

- 每会话独立 preview origin。
- 一次性 ticket 换取 HttpOnly cookie。
- HTTP 和 WebSocket 代理。
- 页面级 Realtime WebSocket 状态广播。
- iframe 和外部窗口展示。
- 会话关闭时释放代理连接。

新增 runtime upstream connector，直接从 Gateway server 通过 `agent-runtime` Docker 内网连接受信的 `browserUrl`，并在 HTTP/WebSocket upstream 请求中注入当前 Runtime capability token。它不经过浏览器、不经过 SSH，也不暴露 Runtime Manager HMAC 凭据或 Runtime token。

### 7.3 授权

- Gateway 根据当前会话用户取得其 `user_agent_runtime` 记录。
- 只允许打开当前用户自己的 Runtime browser。
- DataOps 项目上下文不改变 Runtime 所有权。
- preview ticket 继续单次使用并限制 60 秒有效期。
- 用户退出登录、Realtime 页面断开或 Runtime 重启时关闭对应 preview session。
- 日志只记录 user ID、runtime ID、session ID 和状态，不记录 Cookie、Profile 内容或网页表单数据。

## 8. Gateway 前端

### 8.1 按钮行为

对于托管 Runtime，现有“浏览器”按钮不再弹出 URL 输入框，直接：

1. 检查当前 Runtime 状态。
2. Runtime 未启动时调用现有启动流程。
3. 创建 runtime browser preview session。
4. 在现有 Workspace Dock Browser Panel 中加载 noVNC。

现有任意 URL Web Preview 能力保留在代码和远端 SSH host 场景中，不为第一期新增独立主导航按钮。

### 8.2 最小状态

前端只展示：

- 未启动：一个“启动浏览器”按钮。
- 启动中：复用现有加载动画。
- 已启动：显示 noVNC iframe，不额外显示状态卡片。
- 启动失败：错误摘要和“重试”按钮。

不增加控制权切换、浏览器标签页列表、登录态列表、任务队列或浏览器设置页面。

### 8.3 共同操作

用户键鼠输入通过 noVNC 进入 Chromium；Codex 操作通过 Playwright MCP/CDP 进入同一个 Chromium。第一期允许两者并发，不实现锁或暂停协议。

双方同时导航或点击时可能相互干扰。该风险作为第一期明确接受的限制，后续只有在真实使用证明需要时才增加“暂停 Agent”能力。

## 9. Search MCP 与 SearXNG

SearXNG 保持现状，不与可视化浏览器合并：

- Search MCP/SearXNG 用于快速、结构化、低成本的公开网页检索。
- 浏览器用于登录态、动态页面、表单、下载和交互操作。
- Agent 可以根据任务选择 Search MCP 或 `org__browser`。
- 前端不增加 SearXNG 入口或状态展示。

## 10. 数据与生命周期

浏览器数据流：

```text
用户键鼠 -> Gateway preview proxy -> noVNC -> Chromium
Codex tool call -> playwright-mcp -> CDP -> Chromium
Chromium Profile -> /codex-home/browser-profile -> Docker named volume -> /data/docker/volumes
```

生命周期规则：

- Runtime 首次创建时浏览器 Profile 不存在，由 Chromium 创建。
- Runtime stop/start、restart 和镜像 upgrade 继续复用原 `codex-home` 卷。
- Runtime remove 默认不删除用户卷，因此登录态保留；明确删除用户数据时才删除卷。
- 一个用户 Runtime 只允许一个 Chromium 使用该 Profile。
- 浏览器崩溃后 supervisor 可以重启 Chromium，但不清除 Profile。
- Profile 损坏不自动删除，只返回稳定错误并要求管理员或用户明确重置。

## 11. 错误处理

稳定错误码至少包括：

- `runtime_not_started`
- `runtime_browser_starting`
- `runtime_browser_unavailable`
- `runtime_browser_proxy_failed`
- `runtime_browser_profile_locked`

Gateway 只向前端返回可操作的错误摘要；内部进程命令、容器网络地址和原始 noVNC/CDP 响应不返回浏览器。

前端失败状态只提供“重试”。supervisor 在后台持续恢复浏览器；重试重新读取 Runtime/browser 状态并在恢复后创建新的 preview session，不自动重建用户 Runtime，也不删除 Profile。

## 12. 测试

### 12.1 单元与契约测试

- Runtime contracts 验证 `browserUrl` 和 browser status 枚举。
- Runtime Manager 验证只返回受管容器的固定 `6080` endpoint。
- Docker create spec 验证 `4500/tcp`、`6080/tcp` 都不发布宿主机端口。
- Runtime browser status 验证 absent、stopped、starting、ready、failed。
- Gateway runtime upstream connector 验证用户所有权和受信 endpoint，拒绝任意 URL/端口。
- Browser Preview 会话验证 ticket 单次使用、cookie 隔离和 Runtime 重启清理。
- 前端验证托管 Runtime 不再弹 URL 输入框，并覆盖未启动、加载、成功、失败和重试。
- Capability 迁移验证 `org__browser` 使用 `--cdp-endpoint` 且不包含 `--headless`、`--user-data-dir`。

### 12.2 Runtime 镜像 smoke test

- Xvfb、窗口管理器、Chromium、x11vnc、noVNC 和 websockify 均存在。
- Chromium CDP `/json/version` 可用。
- noVNC HTTP 入口和 WebSocket 可用。
- Chromium 运行用户为 `10001`。
- Profile 路径位于 `/codex-home/browser-profile`。
- Codex App Server 在浏览器进程失败时仍能启动并保持健康。

### 12.3 容器化 E2E

使用真实 Runtime Manager、Docker、Codex App Server、Playwright MCP 和 Chromium 验证：

1. 新用户 Runtime 启动后 Browser Panel 显示真实 Chromium。
2. Codex 通过 `org__browser` 打开测试页面，noVNC 中能看到同一页面。
3. 测试通过 noVNC 输入内容，Codex 随后能从同一页面读取该内容。
4. 设置测试 Cookie 后重启 Runtime，Cookie 和页面 Profile 数据仍存在。
5. 两个用户 Runtime 的 Profile 和浏览器画面互不可见。
6. Agent Runtime 没有宿主机端口绑定，浏览器只能通过 Gateway 访问。
7. 浏览器启动失败时聊天仍可使用，Browser Panel 显示失败和重试。
8. Search MCP/SearXNG 原有搜索测试继续通过。

## 13. 镜像与发布

该功能涉及三个生产镜像：

```text
hub.exdmp.cn:8099/agent/super-ai-docker:gateway-<commit>
hub.exdmp.cn:8099/agent/super-ai-docker:runtime-manager-0.153.4-<commit>
hub.exdmp.cn:8099/agent/super-ai-docker:agent-runtime-0.153.4-browser-<build>
```

不需要重建 Search MCP 或 SearXNG。

发布顺序：

1. 上传 Agent Runtime、Runtime Manager、Gateway 新镜像。
2. 更新 Runtime Manager 镜像别名，保留旧 stable 镜像作为回滚项。
3. 部署 Runtime Manager 和 Gateway。
4. 逐个升级测试用户 Runtime，验证浏览器和原聊天能力。
5. 验证通过后再升级其他长期 Runtime。

回滚时将 Runtime 镜像别名恢复到旧版本，并重新创建受影响 Runtime；`codex-home` 和 `workspace` 卷不删除，因此用户项目和旧 Profile 数据保留。

## 14. 验收标准

1. 托管 Runtime 的“浏览器”按钮不再要求输入 URL。
2. 用户在 Gateway 看到的 Chromium 与 Codex `org__browser` 控制的是同一进程。
3. 用户和 Agent 可以默认共同操作，不出现人为控制权门槛。
4. 浏览器登录态在 Runtime restart 和 image upgrade 后保留。
5. 不同用户的浏览器 Profile、画面和 preview ticket 严格隔离。
6. CDP、VNC 和 noVNC 均不发布宿主机端口。
7. 浏览器失败不阻断聊天，前端提供明确失败和重试。
8. 前端没有新增控制权、标签页、登录态或任务队列管理界面。
9. Search MCP/SearXNG 保持可用且前端无新增配置。
10. 相关 unit、image smoke 和真实容器化 E2E 通过。

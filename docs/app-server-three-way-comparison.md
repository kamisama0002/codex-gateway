# Codex App Server 三方接口对照

本文对照以下三个组件在当前代码状态下的 Codex App Server 接口覆盖：

- [T3 Code](https://github.com/pingdotgg/t3code)，当前主分支，协议生成器固定到 upstream ref `678157acaa819d5510adfe359abb5d0392cfe461`。
- [desktop-cc-gui](https://github.com/zhukunpenglinyutong/desktop-cc-gui)，当前主分支，Tauri 2 + React 19 + Rust。
- 当前 `codex-gateway`，commit `82ce4a6`。

## 统计口径

接口统计分为两层：

1. **实际调用集合**：源码中运行时实际发出的 App Server 请求方法。这个集合用于交集和差集计算。
2. **协议声明集合**：生成的 Client/Server 方法类型和通知类型。它表示协议 Client 的类型覆盖，不等于产品已经把功能接到 UI 上。

T3 Code 有完整的生成型协议 Client，因此声明集合很大；desktop-cc-gui 和 Gateway 都使用自由字符串方法名的 JSON-RPC Client，没有同等规模的集中方法注册表。

## 数量总览

| 指标 | T3 Code | desktop-cc-gui | codex-gateway |
|---|---:|---:|---:|
| 实际调用的客户端请求 | 12 | 17 | 28 |
| 客户端通知 | 1 (`initialized`) | 1 (`initialized`) | 1 (`initialized`) |
| 协议声明的客户端请求 | 92 | 未集中声明 | 未集中声明 |
| 协议声明的服务端请求 | 10 | 未集中声明 | 未集中声明 |
| 协议声明的服务端通知 | 72 | 未集中声明 | 未集中声明 |
| 实际处理的服务端请求 | 4 类显式处理 | 以通用事件/审批通道处理 | 8 类官方请求 + `currentTime/read` |

## 实际调用集合

### T3 Code：12 个

来源主要是 `apps/server/src/provider/Layers/CodexProvider.ts` 和 `CodexSessionRuntime.ts`。

```text
account/read
config/mcpServer/reload
feedback/upload
initialize
model/list
skills/list
thread/read
thread/resume
thread/rollback
thread/start
turn/interrupt
turn/start
```

### desktop-cc-gui：17 个

来源主要是 `src-tauri/src/shared/codex_core.rs`、`src-tauri/src/codex/mod.rs`、`src-tauri/src/backend/app_server.rs` 及自动压缩和标题生成逻辑。

```text
account/rateLimits/read
account/read
collaborationMode/list
initialize
mcpServerStatus/list
model/list
review/start
skills/list
thread/archive
thread/compact/start
thread/fork
thread/inject_items
thread/list
thread/resume
thread/start
turn/interrupt
turn/start
```

### codex-gateway：28 个

来源主要是 `server/utils/gateway/runtime`、`infra` 和 `realtime`。

```text
fs/unwatch
fs/watch
fuzzyFileSearch
initialize
mcpServer/event/stream/start
mcpServer/event/stream/stop
mcpServerStatus/list
model/list
thread/archive
thread/delete
thread/goal/clear
thread/goal/get
thread/goal/set
thread/items/list
thread/list
thread/loaded/list
thread/name/set
thread/read
thread/resume
thread/settings/update
thread/start
thread/turns/list
thread/unarchive
thread/unsubscribe
turn/interrupt
turn/settings/update
turn/start
turn/steer
```

## 集合运算

定义：

```text
T = T3 Code 实际调用集合，|T| = 12
D = desktop-cc-gui 实际调用集合，|D| = 17
G = codex-gateway 实际调用集合，|G| = 28
```

### 两两交集

```text
T ∩ D = {
  account/read,
  initialize,
  model/list,
  skills/list,
  thread/resume,
  thread/start,
  turn/interrupt,
  turn/start
}
|T ∩ D| = 8
```

```text
T ∩ G = {
  initialize,
  model/list,
  thread/read,
  thread/resume,
  thread/start,
  turn/interrupt,
  turn/start
}
|T ∩ G| = 7
```

```text
D ∩ G = {
  initialize,
  mcpServerStatus/list,
  model/list,
  thread/archive,
  thread/list,
  thread/resume,
  thread/start,
  turn/interrupt,
  turn/start
}
|D ∩ G| = 9
```

### 三者交集

```text
T ∩ D ∩ G = {
  initialize,
  model/list,
  thread/resume,
  thread/start,
  turn/interrupt,
  turn/start
}
|T ∩ D ∩ G| = 6
```

### 只属于单个实际调用集合的接口

```text
T - (D ∪ G) = {
  config/mcpServer/reload,
  feedback/upload,
  thread/rollback
}
```

```text
D - (T ∪ G) = {
  account/rateLimits/read,
  collaborationMode/list,
  review/start,
  thread/compact/start,
  thread/fork,
  thread/inject_items
}
```

```text
G - (T ∪ D) = {
  fs/unwatch,
  fs/watch,
  fuzzyFileSearch,
  mcpServer/event/stream/start,
  mcpServer/event/stream/stop,
  thread/delete,
  thread/goal/clear,
  thread/goal/get,
  thread/goal/set,
  thread/items/list,
  thread/name/set,
  thread/settings/update,
  thread/turns/list,
  thread/unarchive,
  thread/unsubscribe,
  turn/settings/update
}
```

三者实际调用集合的并集共有 `39` 个不同接口：

```text
|T ∪ D ∪ G| = 39
```

## T3 的协议声明差集

T3 Code 的生成 Client Request 集合有 `92` 个方法。与 Gateway 的 `28` 个实际调用集合比较：

```text
T3 声明集合 ∩ Gateway 实际调用集合 = 22
Gateway 实际使用、但 T3 当前协议快照未声明 = 6
T3 声明、Gateway 当前未实际使用 = 70
```

Gateway 当前额外使用的 6 个方法是：

```text
mcpServer/event/stream/start
mcpServer/event/stream/stop
thread/items/list
thread/settings/update
thread/turns/list
turn/settings/update
```

这通常表示 App Server 版本或协议快照存在差异，不表示 T3 永久缺少这些能力。

T3 声明但 Gateway 当前没有实际使用的方法，主要集中在以下功能组：

- `thread/fork`、`thread/rollback`、`thread/compact/start`、`thread/metadata/update`、`thread/inject_items`
- `plugin/*`、`marketplace/*`、`app/*`
- `fs/readFile`、`fs/writeFile`、`fs/readDirectory`、`fs/remove` 等完整文件接口
- `review/start`、`modelProvider/capabilities/read`、`permissionProfile/list`
- `experimentalFeature/*`
- `mcpServer/oauth/login`、`mcpServer/resource/read`、`mcpServer/tool/call`
- `account/*`、`command/exec*`、`config/*`、`externalAgentConfig/*`

其中一部分是账户、插件、市场和配置管理能力，不应直接等同于当前产品缺陷。

## 服务端请求和通知

### T3 Code

T3 的生成协议 Client 声明 `10` 类服务端请求，其中官方 App Server 请求包括：

```text
item/commandExecution/requestApproval
item/fileChange/requestApproval
item/tool/requestUserInput
mcpServer/elicitation/request
item/permissions/requestApproval
item/tool/call
account/chatgptAuthTokens/refresh
attestation/generate
```

当前 `CodexSessionRuntime` 显式注册处理器的是前 4 类；其余请求会落到未知请求处理并返回 method-not-found。T3 同时为 `72` 类服务端通知建立了生成类型，并将通知转为统一 Runtime 事件。

### desktop-cc-gui

desktop-cc-gui 没有 T3 那样的生成型请求注册表。它通过 Rust App Server 会话接收 JSONL 事件，再转发到统一事件总线。已实现的重点包括：

- 命令和文件变更审批
- `requestUserInput`
- Plan、Reasoning、Agent Message、Tool、Diff、Token Usage 事件
- 自动压缩相关的 `thread/compact/start`、`thread/compacting`、`thread/compacted`
- turn 超时、错误和重新连接保护

它更偏向本地桌面控制器，未知事件通常保留在原始事件通道，而不是通过一个完整的类型化协议目录暴露给上层。

### codex-gateway

Gateway 的 `CodexRpcClient` 和 `HostRpcSession` 会接收和转发通用 JSON-RPC 消息，当前产品层明确支持：

```text
item/commandExecution/requestApproval
item/fileChange/requestApproval
item/tool/requestUserInput
mcpServer/elicitation/request
item/permissions/requestApproval
item/tool/call
account/chatgptAuthTokens/refresh
attestation/generate
```

此外还有 Gateway 内部处理的 `currentTime/read`。通知采用事件记录和投影模式，重点覆盖线程生命周期、Turn、Item、Reasoning、Plan、Diff、MCP、文件监听和服务端请求。

## Gateway 本地和远端运行模式

Gateway 目前不是两套业务实现，而是两种 App Server 传输方式共用同一个 Broker。两种模式最终都进入 `CodexRpcClient`、`HostRpcSession`、`ControllerRegistry`、`ThreadController` 和 `ThreadBroker`。

### 本地 Managed Runtime

这里的“本地”指 Gateway 服务器管理的本地 Docker Runtime，不是浏览器直接运行 Codex。

```text
Web Client
  -> codex-gateway
  -> Runtime Manager HTTP
  -> 每用户一个 codex-agent-runtime 容器
  -> 容器内 codex app-server
  -> ManagedCodexRpcTransport WebSocket
```

主要实现位置：

- `server/utils/gateway/runtime-manager/runtime-service.ts`：按用户执行 provision/start/stop/restart/remove/upgrade，并持久化运行状态和审计记录。
- `packages/agent-runtime-manager/src/lifecycle-service.ts`：校验 runtimeId、userHash、镜像别名和生命周期状态。
- `packages/agent-runtime-manager/src/docker-engine.ts`：创建隔离容器、两个持久卷和内部网络端点。
- `docker/agent-runtime-entrypoint.sh`：在容器内启动 `codex app-server --listen ws://0.0.0.0:4500`。
- `server/utils/gateway/infra/rpc/managed-rpc-transport.ts`：使用 Runtime Manager 下发的一次性服务令牌建立 WebSocket。
- `server/utils/gateway/runtime-manager/codex-runtime-driver.ts`：把 Managed Runtime 暴露为通用 `AgentRuntimeDriver`，目前只覆盖通用对话、Turn、中断和审批接口。

当前隔离和安全措施：

- 每个用户独立容器、`codex-home` 卷和 `workspace` 卷。
- 容器使用 UID `10001`、只读根文件系统、`CapDrop=ALL`、`no-new-privileges`、PID/内存/CPU 限制。
- App Server 端口 `4500` 不发布到宿主机，只在 `agent-runtime` Docker 网络中可达。
- WebSocket 使用服务令牌，容器启动后立即从环境变量中移除原始令牌，只向 App Server 传递 SHA-256 摘要校验参数。
- Runtime Manager 只把用户已授权的 Provider/Model 以受限内部 Gateway `/api/internal/providers/:id/v1/responses` 地址注入容器。
- `finishCompatibility()` 会连接 App Server、检查版本和协议摘要后才把 Runtime 标记为 `ready`。

本地 Managed Runtime 当前的产品接口缺口：

- `CodexAppServerDriver` 只暴露 `startConversation/readConversation/startTurn/interrupt/respondToApproval`，不是完整的 Gateway 线程 Broker API。
- 用户界面使用完整线程能力时，仍依赖 `resolveManagedHost()` 生成保留 Host ID，再走普通 `ThreadBroker`；Driver 和 Web UI 的能力边界还没有完全统一。
- Runtime Manager 只验证版本和静态 `schemaHash`，还没有对每个 App Server 方法做运行时 capability probe。
- Provider 配置只允许 `wireApi = responses`，不支持本地 Managed Runtime 直接使用 `chat/completions` 上游；Chat Completions 只能通过 Gateway Provider Proxy 转换。
- Managed Runtime 没有独立的 App Server `threadSection/list`、`thread/section/move` 产品路由；当前只在 E2E 辅助代码中使用这些接口来整理测试线程。

### 远端 SSH Host

```text
Web Client
  -> codex-gateway
  -> SSH exec channel
  -> 远端 CODEX_HOME/app-server-control Unix Socket
  -> codex app-server proxy
  -> Codex App Server
```

主要实现位置：

- `server/utils/gateway/infra/rpc/rpc-transport.ts`：通过 SSH 打开远端执行通道，把通道包装成 `ws://localhost/rpc`。
- `server/utils/gateway/infra/ssh/remote-command.ts`：探测 Codex、启动或复用 Unix Socket App Server，并运行 `codex app-server proxy`。
- `server/utils/gateway/infra/codex/codex-runtime.ts`：远端 CLI 版本检查、升级、重启和代理失败恢复。
- `server/utils/gateway/infra/codex/app-server-runtime-probe.ts`：读取运行状态、检查 `thread/loaded/list`、发现活动线程和停止旧 App Server。
- `server/utils/gateway/runtime/host-runtime-supervisor.ts`：用户配置加载后自动连接 SSH Host，恢复线程订阅并扫描运行中的主线程。

远端模式的特点：

- App Server 的 `CODEX_HOME`、模型配置、登录态、Skills 和 MCP 配置都在远端主机。
- Gateway 不会把远端 App Server 的端口暴露到公网，所有 RPC 流量都在 SSH 通道内。
- SSH Host 的认证可以是密码、私钥或代理，Host 配置修改会使连接、线程控制器、文件监听和 tmux 资源失效并重建。
- 版本升级只针对 SSH Host；Managed Runtime 使用固定镜像版本和 Runtime Manager 的兼容性检查。
- Gateway 会自动恢复主线程监听，但对旧的已归档线程不会自动 `thread/resume`，避免把归档会话错误地重新订阅。

远端模式的产品接口缺口：

- 当前 Host 配置模型只有 SSH 连接信息，没有把远端 App Server 的服务令牌、WebSocket 端点和版本能力作为独立资源管理。
- `codex app-server proxy` 依赖远端用户 Shell、Node、Codex 安装路径和 `CODEX_HOME`；环境变化时会进入版本修复或重连流程，不能像 Managed Runtime 一样完全可复现。
- Provider 配置由远端 `config.toml` 决定，不经过 Gateway 的用户 Model Grant 和 Runtime Provider Proxy，因此与本地 Managed Runtime 的模型授权边界不同。
- 远端 App Server 连接恢复后只恢复已知的活动主线程；未加载、已归档、子 Agent 和没有完整快照的线程需要浏览器重新打开。

### 两种模式共用和不同的接口

| 能力 | Managed Runtime | SSH Host |
|---|---|---|
| `initialize`、`thread/*`、`turn/*`、MCP、审批 | 共用 `ThreadBroker` | 共用 `ThreadBroker` |
| 启动方式 | Runtime Manager + Docker 容器 | SSH 远程命令 + Unix Socket + proxy |
| RPC 传输 | 内部 WebSocket + Bearer 服务令牌 | SSH Channel 上的本地 WebSocket proxy |
| Provider 配置 | Gateway 用户授权注入，固定 Responses Proxy | 远端 `CODEX_HOME/config.toml` |
| 用户隔离 | 容器、卷、网络、Token 全部按用户隔离 | 依赖 SSH 账号、CODEX_HOME 和远端文件权限 |
| 版本管理 | 固定 Runtime 镜像版本 | 连接时探测并可自动安装/升级远端 CLI |
| 断线恢复 | Runtime 重启后重新解析端点并探测兼容性 | SSH 重连、代理重建、活动线程恢复 |
| 公网暴露 | App Server 端口不发布 | App Server 端口不发布，只走 SSH |
| 完整产品线程 API | 走普通 Gateway Host Broker | 走普通 Gateway Host Broker |

## CentOS10 运行核验

在当前测试机上进行了只读核验：

- Gateway 容器 `codex-gateway:08f2eb7`：`healthy`。
- Runtime Manager：运行中。
- Managed Runtime 容器：运行中，App Server 在容器内监听 `4500`，健康检查通过。
- SSH Host：远端 `codex app-server` 和 Gateway 启动的 `codex app-server proxy` 进程均存在。
- Gateway 端口 `3100`：首页返回 HTTP `200`。
- 远端模型服务 `172.25.107.50:18080` 当前不可达，这属于 Provider 服务问题，不是 App Server 传输问题；远端线程会因此在模型 `/responses` 阶段重试。

## 当前缺口优先级

### 必须补齐的 App Server 产品能力

- `thread/fork`：前端 Fork 交互和新线程元数据关联。
- `thread/rollback`：回滚指定 Turn，并同步 Gateway 快照、事件游标和 UI 历史。
- `thread/compact/start`：手动压缩和压缩进度事件。
- `review/start`：统一 Review/Diff 入口，不能只依赖文件 Diff 的旁路实现。
- `skills/list` 和 `config/mcpServer/reload`：让 Skills/MCP 配置在本地和远端模式下行为一致。
- 远端和 Managed Runtime 统一 Provider 授权、模型目录和错误分类。

### 可以后置的接口

- `plugin/*`、`marketplace/*`、`app/*`。
- `account/login/*`、`account/usage/read`、`account/workspaceMessages/read`。
- `windowsSandbox/*` 和独立 `command/exec*`。
- `externalAgentConfig/*`。
- `mcpServer/oauth/login`、`mcpServer/resource/read`、`mcpServer/tool/call`，除非业务 MCP 明确需要由 Gateway 代替 App Server 直接调用。

### 架构层待统一的问题

- App Server 协议 Client、通用 `AgentRuntimeDriver` 和 Gateway WebSocket API 目前有三套能力描述，新增接口需要同时维护三处映射。
- Managed Runtime 和 SSH Host 的 Provider 配置、模型权限、版本检查和 capability probe 尚未完全同构。
- T3/desktop-cc-gui 的协议生成 Client 可以作为类型层参考，但不能直接覆盖 Gateway 的远程 Host、用户隔离和业务 MCP 边界。

## 其他 App Server 相关项目

以下项目是本次补充调研后保留的高相关项目。星数为 GitHub 当前公开数据，主要用于判断社区活跃度，不代表功能质量。

| 项目 | Stars | 协议/运行方式 | 主要价值 | 是否适合作为 Gateway 基础 |
|---|---:|---|---|---|
| [Boop Agent](https://github.com/raroque/boop-agent) | 1,350 | Codex App Server + Claude Agent SDK | Dispatcher、子 Agent、Memory、Automation、Integration | 适合借鉴，不直接替换 |
| [Agmente](https://github.com/rebornix/Agmente) | 540 | iOS + ACP/Codex App Server | 移动端远程连接、审批、事件流 | 适合移动端参考 |
| [CodexBridge](https://github.com/Gan-Xing/CodexBridge) | 436 | 微信桥接到 Codex App Server | 消息渠道、线程、审批、自动化、上传 | 适合渠道适配参考 |
| [Noobi.ai](https://github.com/Innate-Labs/Noobi.ai) | 247 | 本地 Desktop + Codex App Server | Planner、Implementer、Reviewer、构建/测试闭环 | 适合工作流参考 |
| [codex-manager](https://github.com/jmillpps/codex-manager) | 5 | Fastify + Web + Python SDK + App Server STDIO | 完整控制面、远程技能、生命周期 API | 思路适合，社区太小 |
| [codex-webui](https://github.com/lezi-fun/codex-webui) | 9 | WebSocket/STDIO + Codex App Server | 审批、流式工具、Diff Review、移动 Web | 适合局部 UI 参考 |
| [codex-remote-control-lab](https://github.com/Sunwood-ai-labs/codex-remote-control-lab) | 17 | 本地 App Server + Token LAN Bridge | 手机接管桌面线程、令牌保护、历史同步 | 适合远程安全边界参考 |
| [codex-sdk-rs](https://github.com/yukkit/codex-sdk-rs) | 5 | Rust SDK，本地或远程 WebSocket/Unix Socket | Remote App Server、线程和事件流抽象 | 适合传输层参考 |
| [codex-sdk-go](https://github.com/pmenglund/codex-sdk-go) | 16 | Go SDK + JSON-RPC/STDIO | 类型化请求、流式 Turn、审批回调 | 适合 SDK 设计参考 |
| [mosoo-agent-driver](https://github.com/langgenius/mosoo-agent-driver) | 73 | Codex App Server + Claude SDK + ACP | 统一 Runtime Driver、权限、诊断和生命周期 | 最适合参考多 Runtime 抽象 |
| [harness-cli](https://github.com/hyspacex/harness-cli) | 15 | Claude SDK/Codex App Server 混合角色 | Research/Plan/Generate/Evaluate 分工和长期任务 | 适合编排和评测参考 |
| [open-worker](https://github.com/HOOLC/open-worker) | 16 | Slack Socket Mode + Codex App Server | Slack 线程映射、隔离工作区、持久会话 | 适合消息渠道和隔离参考 |
| [codex-plugin-dsh](https://github.com/wingoo/codex-plugin-dsh) | 8 | DeepSeek Harness Provider + 本地 App Server | 将 Codex 作为其他 Harness 的模型/运行时 Provider | 适合混合 Harness 参考 |
| [IntelligenceX](https://github.com/EvotecIT/IntelligenceX) | 9 | .NET + App Server JSON-RPC | GitHub Actions Review、CLI/Web Wizard | 适合 .NET 场景参考 |
| [codex-exec-remote](https://github.com/professional-ALFIE/codex-exec-remote) | 5 | 远程 App Server 命令行桥 | start/resume/stream 的最小实现 | 只能参考，默认全权限有风险 |

### 重点项目结论

#### `codex-sdk-rs`

这是调研中最明确支持“已有远程 App Server”的 SDK 之一：

- `Codex::remote_websocket(...)`
- `Codex::remote_unix_socket(...)`
- 长期线程事件流、Turn、审批和模型读取

它可以作为 Gateway 远程传输抽象的 Rust 参考，但版本基于较早的 Codex Rust crate，项目本身也明确属于 early implementation，不建议替换现有 TypeScript Gateway。

#### `Codex Remote Control Lab`

它把 App Server 保持在 `127.0.0.1`，只开放一个 Token 保护的手机桥接层，避免直接把 App Server 端口暴露到 LAN。这与 Gateway 的“SSH/内部网络传输，不公开 App Server 端口”原则一致，适合借鉴：

- Token 化配对
- 单线程远程接管
- 历史同步和重新打开
- 断线、审批和完成通知

#### `mosoo-agent-driver`

它不是 UI，而是一个 Runtime Kernel，统一：

```text
Codex App Server
Claude Agent SDK
ACP Agent
        -> 统一 Driver 事件和生命周期
```

它的边界设计与我们后续要支持 Agents SDK/ACP 的方向最接近。它把凭证、文件、Skills、MCP、权限、持久化留给宿主应用，和 Gateway 的产品边界相符。

#### `codex-manager`

它更像一个轻量版 Gateway：

- Fastify API
- WebSocket 事件流
- App Server STDIO 监管
- Web UI
- Python SDK
- 线程、审批和远程技能

但 Stars 和更新频率都很低，适合阅读 API 组织方式，不适合作为生产基础。

#### `codex-plugin-dsh`

它证明了 Codex App Server 可以作为另一个 Harness 的 Provider：

```text
DeepSeek Harness
    -> Codex Provider Plugin
    -> 本地 Codex App Server
```

它对我们未来接入 Hermes、DeepSeek Harness 或其他 Agent Runtime 很有参考价值，但其工具权限和会话生命周期由 DSH 管理，不能直接复制到 Gateway。

## 运行模式结论

不同项目所谓的“远程”不是同一种能力：

| 远程形态 | 代表项目 | 含义 |
|---|---|---|
| 远程客户端 -> 远程产品 Server | T3 Code | 客户端连接远程 T3 Server，T3 Server 在远端启动 App Server |
| 手机/浏览器 -> 本机桥接 -> App Server | Codex Remote Control Lab、Agmente | App Server 通常仍在本机，桥接层负责认证和转发 |
| 应用 -> 已有远程 App Server | codex-sdk-rs、codex-exec-remote、当前 Gateway | 直接连接远端 WebSocket/Unix Socket/SSH Proxy |
| Harness -> Codex App Server Provider | codex-plugin-dsh、Boop Agent | 将 Codex 作为另一个 Agent 平台的运行时或 Provider |
| 应用 -> 本机子进程 App Server | desktop-cc-gui、codex-manager、T3 Server | 应用自己启动并监管 `codex app-server` |

当前 Gateway 同时覆盖了两种最重要的服务形态：

```text
本地 Managed Runtime：每用户 Docker 容器内 App Server
远端 SSH Host：SSH 连接已有或自动启动的远端 App Server
```

因此不需要为了“支持远程”再引入 T3 的完整 Server。更值得补的是：

1. 借鉴 `codex-sdk-rs` 的 Remote WebSocket/Unix Socket 抽象，统一 SSH 和 Managed Transport。
2. 借鉴 `mosoo-agent-driver` 增加 `ACPAdapter` 和 `AgentsSdkAdapter`。
3. 借鉴 `codex-remote-control-lab` 增强远程配对、Token 和断线恢复。
4. 借鉴 `codex-manager` 的 Python/HTTP 控制面思路，为自动化和业务系统提供稳定 API。
5. 借鉴 `codex-plugin-dsh` 的 Provider 模式，让 Codex、Claude、ACP 和业务 Agent 共用 Gateway 的用户、MCP、审计和隔离能力。

## 功能侧对照

| 能力 | T3 Code | desktop-cc-gui | codex-gateway |
|---|---|---|---|
| 新建和恢复线程 | 已实现 | 已实现 | 已实现 |
| Fork | 协议有声明，当前 Codex Runtime 未实际调用 | 已实现 | 当前未实现 |
| Rollback | 已实现 | 当前未见主流程调用 | 当前未实现 |
| Archive/Delete/Unarchive | 协议有声明，当前 Runtime 未接入主流程 | Archive 用于隐藏辅助线程 | 已实现完整生命周期 |
| 线程分页 | 当前 Runtime 未接入 | 主要依赖本地历史和事件 | 已实现 `thread/turns/list`、`thread/items/list` |
| MCP 状态 | 协议有声明，Runtime 主要做 reload | 已实现状态读取 | 已实现状态和事件流 |
| Skills | `skills/list` | `skills/list` | 当前没有直接调用 `skills/list` |
| Review | 当前 Runtime 未接入 | 已实现 `review/start` | 当前未接入 App Server `review/start` |
| 远程 SSH | 非核心路径 | 非核心路径 | 已实现 |
| 长期容器和多用户 | 非核心路径 | 本地优先 | 已实现 Runtime Manager 方向 |

## 结论

1. **协议 Client 完整度**：T3 Code 最高。它有 `92` 个客户端请求和 `72` 个通知的生成类型，但实际 Codex Runtime 只使用其中 `12` 个。
2. **桌面 Codex 能力**：desktop-cc-gui 当前实际调用 `17` 个接口，覆盖 `Fork`、自动压缩、Review、Skills 和本地多引擎桌面体验，适合作为桌面端参考。
3. **远程产品化能力**：Gateway 实际调用 `28` 个接口，线程分页、远程文件监听、MCP 事件流、归档生命周期和多用户 Runtime 是它相对 T3/desktop-cc-gui 的主要优势。
4. **当前最值得补到 Gateway 的接口**：`thread/fork`、`thread/rollback`、`thread/compact/start`、`skills/list`、`config/mcpServer/reload`、`review/start`。
5. **不建议一次性搬完 T3 的 70 个差集接口**：插件市场、账户、Windows 沙箱、独立命令执行等属于可选产品面，应按实际业务需求增量接入。

推荐的组合仍然是：

```text
Gateway：Web、用户、权限、远程 Host、Docker Runtime、业务 MCP、知识库
T3 Code：生成型 App Server Client、Codex Adapter、Provider Driver、身份指令
desktop-cc-gui：Tauri 桌面端、Codex 本地运行、Fork/Review/压缩和多引擎交互
```

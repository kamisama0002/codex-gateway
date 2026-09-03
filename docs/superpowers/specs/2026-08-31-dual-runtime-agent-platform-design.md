# 双运行时通用 Agent 平台第一、二期设计

> 日期：2026-08-31  
> 状态：设计已在对话中逐节确认，等待书面复核  
> 主要仓库：`codex-gateway`  
> 参考实现：`codex-mobile`、`openai/codex`  
> 相关文档：[`docs/app-server-interface-coverage.zh-CN.md`](../../app-server-interface-coverage.zh-CN.md)

## 1. 背景

平台第一版面向内部运营人员。用户可以描述业务需求，例如查询营业额；Agent 根据用户所属项目调用业务 MCP 和知识库 MCP，结合业务数据与知识返回分析。写入业务系统仍然通过 MCP，执行前由用户确认，并保存完整审计记录。

现有 Web 基线为 `codex-gateway`，执行内核为 Codex Harness / App Server。`codex-mobile` 提供了模型协议转换、运行时 Schema 目录、Skills/Plugins/Apps/MCP 管理，以及 Fork、Archive、Rollback、Review 等可借鉴实现，但它采用单用户、单 App Server 全局实例和大文件状态结构，不能直接作为多用户平台底座。

本设计只覆盖前两期：

1. 模型协议转换、App Server Schema 生成和兼容检查。
2. Skills、Plugins、Apps、MCP 管理，以及 Fork、Archive、Unarchive、Rollback、Review。

PWA、移动抽屉、响应式聊天和语音输入不在本次实施范围。

## 2. 已确认决策

- 采用 `codex-gateway` 原生模块化迁移，不嵌入 `codex-mobile` Bridge，也不复制其全局单例架构。
- 每个用户对应一个长期运行的 Docker Agent 容器；该用户的多个 Thread 复用同一容器。
- 第一版仍同时保留逻辑隔离和 Docker 物理隔离。
- 第一版只实现 Codex App Server Runtime，但平台通用层必须允许以后新增 OpenAI Agents SDK Runtime。
- 模型层采用通用 OpenAI 兼容网关，支持 Responses 透传和 Chat Completions 到 Responses 的双向转换。
- Provider 和 API Key 只由管理员配置；普通用户不能自带 API Key。
- 普通用户可以查看和使用已授权的 Skills、Plugins、Apps、MCP，并完成自己的 MCP OAuth。
- 安装、卸载、升级和全局能力配置仅管理员可操作。
- 浏览器不能直接连接 App Server，也不能把任意 RPC 方法名透传到 App Server。
- Codex 版本和 Schema 固定、可验证、可灰度升级。

## 3. 目标

### 3.1 第一阶段目标

- 为每个用户创建独立、持久化、可恢复的 Codex App Server 容器。
- 管理员可配置多个 OpenAI 兼容 Provider 和模型。
- App Server 使用统一 Responses API 访问平台 Provider Proxy。
- 对只有 Chat Completions 的中国模型完成文本、工具调用、工具结果、流式事件和 Usage 转换。
- 使用 `codex app-server generate-ts` 和 `generate-json-schema` 生成版本化协议产物。
- 在构建、运行和升级时检测 App Server 协议不兼容。

### 3.2 第二阶段目标

- 建立通用能力目录和授权模型。
- 为 Codex Runtime 接入 Skills、Plugins、Apps 和 MCP 管理。
- 实现用户独立 MCP OAuth 和凭证隔离。
- 实现 Fork、Archive、Unarchive、Rollback、Review。
- 所有高影响操作均经过权限检查、用户确认和审计。

### 3.3 长期目标

- 新增 Agents SDK Runtime 时复用 Docker、Provider、MCP、Secret、Audit、Usage 和 Event Bus。
- Agents SDK 只需新增 Runtime Driver 和 Agent/Runner/Session 视图映射。

## 4. 非目标

- 本期不实现 PWA、原生移动端或语音输入。
- 本期不实现用户自带 Provider API Key。
- 本期不实现每个 Thread 一个容器。
- 本期不实现空闲容器自动停机。
- 本期不把 Codex Project 当作业务项目事实源。
- 本期不向普通用户开放 Shell、Process、任意文件写入或任意 App Server RPC。
- 本期不实现 Agents SDK Runtime 本身。
- 本期不承诺所有 OpenAI Chat Completions 兼容服务都具备相同工具能力。

## 5. 总体架构

```text
Browser
  │ HTTPS / page WebSocket
  ▼
Nuxt Gateway
  ├── Authentication + user/project authorization
  ├── Conversation API + realtime event bus
  ├── Provider Gateway
  ├── Capability Catalog
  ├── Secret Store + Audit + Usage
  └── Runtime Client
          │ internal authenticated API
          ▼
Agent Runtime Manager (TypeScript, private Docker network)
  ├── Docker lifecycle
  ├── image/schema/version checks
  ├── capability reconciliation
  └── per-user service-token rotation
          │ Docker Engine / rootless Docker
          ├── User A Agent container
          │     ├── codex app-server
          │     ├── /codex-home volume
          │     └── /workspace volume
          └── User B Agent container
                ├── codex app-server
                ├── /codex-home volume
                └── /workspace volume
```

模型调用：

```text
User App Server container
  │ Responses API + short-lived internal token
  ▼
Gateway Provider Proxy
  ├── Responses passthrough
  └── Chat Completions adapter
          ▼
DeepSeek / Qwen / GLM / Doubao / other compatible provider
```

## 6. 通用平台层与运行时适配层

### 6.1 Runtime Driver

平台使用通用 Runtime Driver，不让上层业务依赖 Codex DTO：

```ts
type RuntimeType = "codex-app-server" | "agents-sdk";

interface AgentRuntimeDriver {
  readonly runtimeType: RuntimeType;
  ensureReady(userId: string): Promise<RuntimeHandle>;
  getCapabilities(handle: RuntimeHandle): Promise<RuntimeCapabilitySnapshot>;
  startConversation(input: StartConversationInput): Promise<PlatformConversation>;
  readConversation(conversationId: string): Promise<PlatformConversationSnapshot>;
  startTurn(input: StartTurnInput): Promise<PlatformTurn>;
  interruptTurn(input: InterruptTurnInput): Promise<void>;
  respondToApproval(input: ApprovalResponseInput): Promise<void>;
}
```

### 6.2 Codex Runtime Driver

`CodexAppServerDriver` 负责：

- Platform Conversation 与 App Server Thread 映射。
- Platform Turn/Item 与 Codex Turn/Item 映射。
- App Server 初始化、订阅、恢复和审批响应。
- Codex Skills、Plugins、Apps、MCP Adapter。
- Fork、Archive、Unarchive、Rollback、Review。
- Codex Schema 与版本检查。

### 6.3 Agents SDK Runtime Driver

本期只保留接口位置，不实现：

- Agent / Runner / Session。
- Tool / MCP。
- Handoff / Guardrail。
- RunState / tracing events。

Agents SDK Runtime 不得依赖 Codex Thread/Turn/Item 类型。

## 7. 每用户 Docker Runtime

### 7.1 容器粒度

- 一个用户一个长期容器。
- 一个用户的多个 Thread 共享该容器和 `CODEX_HOME`。
- 用户之间不共享容器、Volume、App Server Token 或 MCP 用户凭证。
- App Server 只监听 Docker 内部网络 WebSocket，使用用户专属 Token；端口不发布到宿主机。
- Gateway 是 App Server 的唯一客户端入口，浏览器不能解析或访问容器地址。
- 第一版容器启动后保持运行；空闲回收后续实现。

### 7.2 Runtime Manager 边界

公网 Nuxt 服务不直接挂载 Docker Socket。Runtime Manager 作为同仓库 TypeScript 内部服务，暴露固定内部 API：

- provision
- start
- stop
- restart
- inspect
- upgrade
- remove-container
- remove-user-data

Runtime Manager 不提供任意命令、任意镜像或任意挂载参数入口。

### 7.3 状态机

```text
absent
  -> provisioning
  -> starting
  -> schema_checking
  -> syncing_capabilities
  -> ready
  -> degraded
  -> restarting
  -> ready
```

版本或 Schema 不匹配进入 `incompatible`，禁止创建新 Turn。

### 7.4 容器安全配置

- 非 Root 用户。
- `privileged: false`。
- `cap_drop: ALL`。
- 只读 Root Filesystem。
- 独立 `CODEX_HOME` 和 Workspace Volume。
- CPU、内存、PID、日志大小限制。
- 不发布宿主机端口。
- 仅加入 Agent 内部网络。
- 默认只能访问 Provider Proxy 和授权 MCP 目标。
- 容器名和 Label 使用不可逆用户 ID 哈希，不写 PII。
- App Server 使用用户专属短期 Token，轮换后旧 Token 失效。

### 7.5 持久化

新增 `user_agent_runtimes`：

```ts
interface UserAgentRuntimeRecord {
  userId: string;
  runtimeType: RuntimeType;
  containerId: string | null;
  imageVersion: string;
  runtimeVersion: string;
  schemaHash: string;
  status: RuntimeStatus;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}
```

同一用户的 provision/start/upgrade 使用互斥锁和幂等键。

## 8. 第一阶段：Provider Gateway

### 8.1 Provider 数据模型

新增：

```ts
type UpstreamWireApi = "responses" | "chat_completions";

interface ModelProviderDefinition {
  id: string;
  name: string;
  baseUrl: string;
  wireApi: UpstreamWireApi;
  encryptedApiKey: string;
  enabled: boolean;
  requestTimeoutMs: number;
}

interface ProviderModelDefinition {
  providerId: string;
  modelId: string;
  displayName: string;
  enabled: boolean;
  capabilities: ModelCapabilities;
}

interface ModelCapabilities {
  tools: boolean;
  streamingTools: boolean;
  vision: boolean;
  reasoning: boolean;
  maxContextTokens: number | null;
}
```

Provider API Key 使用现有服务端加密能力保存。普通用户 API 永远不返回密钥或可逆密文。

### 8.2 内部模型端点

App Server 容器只访问：

```text
POST /api/internal/providers/:providerId/v1/responses
```

内部请求必须包含：

- 用户专属短期服务 Token。
- Provider ID 和模型 ID。
- Trace/Request ID。

Gateway 根据 Token 恢复用户身份、检查模型授权和配额，然后读取平台 Provider 凭证。

### 8.3 Responses 透传

上游支持 Responses API 时：

- 保留 Responses 语义和 SSE 顺序。
- 根据 Provider 能力处理不支持字段。
- 未授权或不支持的工具在请求发出前返回结构化能力错误。
- 不静默删除可能改变 Agent 行为的工具。

### 8.4 Chat Completions 转换

请求方向：

- Responses `instructions` -> Chat system message。
- Responses message items -> Chat messages。
- `developer` -> system 或 Provider 声明的 developer role。
- `function_call` -> assistant tool call。
- `function_call_output` -> tool message。
- Function tools -> Chat tools。
- Reasoning、temperature、top_p 等仅在 Provider 声明支持时转发。

响应方向：

- Assistant text -> Responses message/output_text。
- Chat tool call -> Responses function_call。
- Usage -> Responses usage。
- Finish reason -> Responses status/error。

### 8.5 流式 Tool Call

必须完整处理：

- 按 choice index、tool index 和 call ID 合并 Delta。
- 分段累积函数名和 JSON arguments。
- 只在完整 Tool Call 可用时生成完成事件。
- 上游提前结束或 JSON 不完整时返回明确错误，不能交给 App Server 执行半个调用。
- 客户端取消必须向上游传播 AbortSignal。

### 8.6 日志和审计

允许记录：

- User ID 哈希、Provider、模型、请求 ID、延迟、Usage、状态码、错误类型。

禁止记录：

- API Key、Authorization Header、完整 Prompt、业务 MCP 返回数据、模型完整输出。

## 9. App Server Schema 与兼容检查

### 9.1 生成产物

固定 Codex 版本执行：

```text
codex app-server generate-ts
codex app-server generate-json-schema
```

生成：

- TypeScript DTO。
- Client Request 方法目录。
- Server Request 方法目录。
- Server Notification 方法目录。
- Client Notification 方法目录。
- Schema Hash 和 Codex 版本 Manifest。

生成产物放在明确的 `shared/generated/app-server/`，由脚本统一覆盖，禁止手工修改。

### 9.2 CI 兼容规则

- 已使用方法被删除：失败。
- 已使用请求/响应字段发生不兼容变化：失败。
- 新增稳定方法或通知：生成报告，不自动标记为已实现。
- Experimental 变化：生成独立报告，根据使用情况决定失败或警告。
- 生成结果与仓库不一致：失败。

### 9.3 运行时检查

- 容器初始化读取 App Server `userAgent`。
- Runtime Manager 验证镜像 Label 中的 Codex 版本和 Schema Hash。
- 与 Gateway 支持 Manifest 不一致时进入 `incompatible`。
- 管理后台显示容器版本、Hash、缺少方法和额外方法。

## 10. 第二阶段：通用能力目录

### 10.1 通用类型

```ts
type CapabilityKind =
  | "skill"
  | "plugin"
  | "app"
  | "mcp"
  | "tool"
  | "agent"
  | "handoff"
  | "guardrail";

interface PlatformCapability {
  id: string;
  runtimeType: RuntimeType;
  kind: CapabilityKind;
  name: string;
  description: string;
  version: string | null;
  enabled: boolean;
  requiresUserAuth: boolean;
}
```

### 10.2 数据表

- `capabilities`
- `capability_assignments`
- `runtime_capability_syncs`
- `user_mcp_credentials`
- `agent_audit_events`

Assignment 支持用户、角色和业务项目范围。最终授权取交集，默认拒绝。

### 10.3 Codex Capability Adapter

- Skills：`skills/list`、`skills/config/write`。
- Plugins：`plugin/list`、`plugin/read`、`plugin/install`、`plugin/uninstall`。
- Apps：`app/list`、`app/read`、`app/installed`。
- MCP：`mcpServerStatus/list`、`mcpServer/oauth/login`、`config/mcpServer/reload`。

### 10.4 Desired State Reconciliation

```text
Admin changes capability
  -> platform desired state
  -> per-user reconciliation job
  -> runtime adapter compares actual state
  -> minimal install/enable/disable/uninstall operations
  -> sync result + audit
```

- 新容器进入 `ready` 前必须完成初始同步。
- 运行容器后台同步。
- 单用户同步失败不阻塞其他用户。
- 失败保留上一可用状态并记录差异。
- Reconcile 操作必须幂等。

### 10.5 权限

管理员：

- 安装、卸载、升级、全局启停、分配授权、查看同步状态。

普通用户：

- 查看和使用被授权能力。
- 完成自己的 MCP OAuth。
- 不能修改全局能力或其他用户凭证。

## 11. MCP OAuth 与凭证隔离

- OAuth 发起请求绑定 User ID、Runtime ID、MCP Server ID 和一次性 State。
- Callback 必须校验 State、过期时间和发起用户。
- Token 使用现有加密层保存到 `user_mcp_credentials`。
- Token 只注入对应用户容器或由用户专属代理路径使用。
- Refresh 失败只影响当前用户。
- 撤销授权后触发该用户容器 MCP Reload。
- 浏览器不接触 Client Secret、Access Token 或 Refresh Token。

## 12. Conversation Actions

平台接口：

```ts
interface ConversationActions {
  fork(conversationId: string, beforeTurnId?: string): Promise<PlatformConversation>;
  archive(conversationId: string): Promise<void>;
  unarchive(conversationId: string): Promise<void>;
  rollback(conversationId: string, numTurns: number): Promise<PlatformConversationSnapshot>;
  startReview(conversationId: string, target: ReviewTarget): Promise<PlatformReviewRun>;
}
```

Codex 映射：

- Fork -> `thread/fork`。
- Archive -> `thread/archive`。
- Unarchive -> `thread/unarchive`。
- Rollback -> `thread/rollback`。
- Review -> `review/start`。

行为规则：

- 每次操作先验证 User、Project 和 Conversation 所属关系。
- Fork 新建平台 Conversation 映射并保留父级关系。
- Archive/Unarchive 通过现有事件总线同步所有页面。
- Rollback 必须二次确认，记录 Turn 数、操作者和执行结果。
- Review 使用独立 Review View Model，不伪装成普通聊天消息。
- 浏览器调用固定平台 API，不提交 App Server 方法名。

## 13. API 边界

### 13.1 浏览器 API

- `/api/me/runtime`
- `/api/agent/conversations/:id/fork`
- `/api/agent/conversations/:id/archive`
- `/api/agent/conversations/:id/unarchive`
- `/api/agent/conversations/:id/rollback`
- `/api/agent/conversations/:id/review`
- `/api/capabilities`
- `/api/capabilities/mcp/:id/oauth/start`

### 13.2 管理员 API

- `/api/admin/providers`
- `/api/admin/provider-models`
- `/api/admin/capabilities`
- `/api/admin/capability-assignments`
- `/api/admin/runtime-syncs`
- `/api/admin/runtimes`

### 13.3 内部 API

- `/api/internal/providers/:providerId/v1/responses`
- Runtime Manager provision/start/stop/restart/inspect/upgrade。

内部 API 与浏览器 API 使用不同认证域和网络边界。

## 14. 事件、审批与写操作

- App Server 的 Server Request 由 Gateway 持久化为 Pending Approval。
- 浏览器刷新或 Gateway 重启后可以恢复 Pending Approval。
- 未知 Server Request 默认拒绝或进入不可执行状态，不能自动同意。
- 业务 MCP 写工具必须带有写操作分类、业务对象、参数摘要和幂等键。
- 用户确认后才向 App Server 返回批准结果。
- 审计记录 User、Project、Thread、Tool、参数摘要、审批人、结果和时间。
- Runtime Driver 只负责协议响应；业务写权限由 MCP 服务端再次验证。

## 15. 错误恢复

### 15.1 Runtime

- App Server 崩溃：容器内重启，Gateway 重连并恢复订阅。
- 容器崩溃：指数退避，连续失败后 `degraded`。
- Gateway 重启：从数据库和 Docker Label 恢复映射。
- 容器配置变化：安全重建，保留 Volume。

### 15.2 Provider

- 401/403：标记管理员凭证失效，普通用户只看到 Provider 暂不可用。
- 429：保留 Retry-After 和 Provider 限流信息。
- 超时或断流：中断上游请求，向 App Server 返回结构化错误。
- 非法 Tool Call：不执行，返回能力或协议错误。

### 15.3 MCP

- OAuth 过期：提示当前用户重新授权。
- MCP 启动失败：显示 Server 级状态，不阻塞无关 MCP。
- Reload 失败：保留旧配置并记录同步失败。

## 16. 升级与回滚

升级路径：

```text
new image
  -> generate schemas
  -> compatibility CI
  -> test user
  -> small cohort
  -> full rollout
```

单用户升级：

1. 阻止新 Turn。
2. 等待或中断当前 Turn。
3. 保存旧镜像、容器配置和 Schema 信息。
4. 停止旧容器。
5. 使用原 Volume 启动新容器。
6. 验证版本、Schema、MCP 和能力同步。
7. 成功后切换 Gateway 连接。
8. 失败时恢复旧镜像。

删除容器默认保留 Volume；只有明确的删除用户数据操作才删除 Volume。

## 17. 测试设计

### 17.1 Unit

- Responses 到 Chat 映射。
- Chat 到 Responses 映射。
- 流式 Tool Call Delta 合并。
- Provider 能力校验。
- Schema Diff 分类。
- Runtime 状态机和互斥。
- Capability Desired/Actual Diff。
- 授权合并和默认拒绝。

### 17.2 Integration

- Provider Proxy 与模拟上游 Responses/Chat 服务。
- 加密 Provider Key 和用户 MCP Token。
- Runtime Manager Docker 生命周期。
- 内部服务 Token 验证和轮换。
- Capability Reconcile 幂等性。

### 17.3 真实 App Server E2E

- 两个用户容器同时运行。
- 用户 A 不能访问用户 B 的 Thread、Volume、MCP Token 或事件。
- 文本流和 Tool Call 流。
- MCP 查询和业务写审批。
- Skills、Plugins、Apps、MCP 同步。
- Fork、Archive、Unarchive、Rollback、Review。
- Gateway/容器重启后的历史、订阅和 Pending Approval 恢复。
- Schema 不匹配时拒绝新 Turn。
- 新镜像失败时恢复旧容器。

## 18. 从 codex-mobile 借鉴的范围

借鉴：

- Responses/Chat Completions 转换思路。
- Provider Wrapper 边界。
- 运行时 `generate-json-schema` 方法目录。
- Skills、Plugins、Apps、MCP 页面信息结构。
- Fork、Archive、Rollback、Review 交互。

不迁移：

- 全局单例 App Server。
- 共享密码认证。
- 浏览器任意 RPC 透传。
- LocalStorage 作为服务端状态事实源。
- 单个巨型 Bridge、状态 Composable 和页面组件。
- Community Free Key 和自动选择第三方免费模型逻辑。

`codex-mobile` 使用 MIT License。若复用具有版权表达的代码而不只是算法思路，必须保留原版权和许可证说明；优先在本项目边界内重新实现并编写独立测试。

## 19. 实施顺序

1. Runtime Driver 接口和每用户 Docker Runtime Manager。
2. Provider 数据模型、管理 API 和 Secret Store 集成。
3. Responses 透传与 Chat Completions 转换。
4. Schema/Type 生成和兼容 CI。
5. 通用能力目录、授权和 Reconcile。
6. Codex Skills、Plugins、Apps、MCP Adapter。
7. 用户 MCP OAuth。
8. Fork、Archive、Unarchive、Rollback、Review。
9. 真实双用户隔离、故障恢复和升级 E2E。

每一步独立测试和提交；不在同一提交中混合 Runtime、Provider、Capability 和 UI 大改。

## 20. 验收标准

- 两个用户可以同时使用各自长期 Agent 容器，数据和事件无交叉。
- 浏览器无法调用未列入平台 API 的 App Server 方法。
- 管理员可以配置至少一个 Responses Provider 和一个 Chat Completions Provider。
- Chat Completions Provider 可以完成一次包含流式 Tool Call 和 Tool Result 的 Codex Turn。
- App Server 版本或 Schema 不匹配时容器不能进入 Ready。
- 管理员可以安装并授权 Codex Skill/Plugin/App/MCP。
- 普通用户只能使用已授权能力，并只能管理自己的 MCP OAuth。
- Fork、Archive、Unarchive、Rollback、Review 使用真实 App Server 完成。
- 所有写操作、能力变更和 Runtime 变更都有审计记录。
- Provider Key、MCP Token、Prompt 和业务数据不会出现在日志、前端或错误详情中。
- 通用 Runtime、Provider、MCP、Secret、Audit 模块不依赖 Codex Thread DTO，允许以后接入 Agents SDK。

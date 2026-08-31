# Codex App Server 接口覆盖矩阵

本文档完整列出 Codex App Server 协议接口，并标记 `codex-gateway` 当前的显式适配情况。接口完整性与第一期产品范围分开讨论：本清单不因为某个接口暂时不属于第一期而省略。

## 1. 基准与判定口径

- Gateway 代码基准：`00bb652`。
- Gateway 声明支持的 Codex 版本：`0.151.0`，定义于 `server/utils/gateway/infra/codex/codex-version.ts`。
- App Server 协议源码基准：`third_party/openai-codex` 提交 `78c290807ce710180111df227df3b7a4fe845452`。
- 协议定义来源：`third_party/openai-codex/codex-rs/app-server-protocol/src/protocol/common.rs`。
- Gateway 扫描范围：`app/`、`server/`、`shared/` 下的生产 TypeScript/Vue 源码，不把测试和第三方源码计入已实现。
- 官方说明：[Codex App Server](https://learn.chatgpt.com/docs/app-server)。

状态含义：

- **已显式适配**：Gateway 生产代码中存在该方法的显式调用、响应处理或方法级事件处理。
- **缺少（未显式适配）**：Gateway 生产代码中没有发现该方法的显式调用或方法级处理。
- Gateway 的 RPC 层可以接收通用 JSON-RPC 信封，但“能够收到未知消息”不等于“已经完成状态投影、UI 展示、用户操作和错误恢复”，因此仍记为未显式适配。
- 本表判断的是协议适配，不代表对应产品功能已经达到业务上线标准。

## 2. 覆盖统计

| 协议方向 | 接口总数 | 已显式适配 | 缺少 |
|---|---:|---:|---:|
| Client → App Server 请求 | 157 | 25 | 132 |
| App Server → Client 反向请求 | 9 | 9 | 0 |
| App Server → Client 通知 | 80 | 60 | 20 |
| Client → App Server 通知 | 1 | 1 | 0 |
| **合计** | **247** | **95** | **152** |

客户端请求覆盖率不能直接用来衡量产品完成度。`thread/start`、`turn/start` 和事件流承载了主要 Agent 执行链路，而很多未适配方法属于插件市场、实时语音、远程控制、系统账号或开发终端等独立能力。

## 3. 客户端请求（Client → App Server）

| # | 方法 | Gateway 状态 |
|---:|---|---|
| 1 | `initialize` | 已显式适配 |
| 2 | `server/diagnostics` | 缺少（未显式适配） |
| 3 | `thread/start` | 已显式适配 |
| 4 | `thread/resume` | 已显式适配 |
| 5 | `thread/fork` | 缺少（未显式适配） |
| 6 | `thread/archive` | 缺少（未显式适配） |
| 7 | `thread/delete` | 缺少（未显式适配） |
| 8 | `thread/unsubscribe` | 已显式适配 |
| 9 | `thread/increment_elicitation` | 缺少（未显式适配） |
| 10 | `thread/decrement_elicitation` | 缺少（未显式适配） |
| 11 | `thread/name/set` | 已显式适配 |
| 12 | `thread/goal/set` | 已显式适配 |
| 13 | `thread/goal/get` | 已显式适配 |
| 14 | `thread/goal/clear` | 已显式适配 |
| 15 | `thread/queue/add` | 缺少（未显式适配） |
| 16 | `thread/queue/list` | 缺少（未显式适配） |
| 17 | `thread/queue/update` | 缺少（未显式适配） |
| 18 | `thread/queue/delete` | 缺少（未显式适配） |
| 19 | `thread/queue/reorder` | 缺少（未显式适配） |
| 20 | `thread/queue/start` | 缺少（未显式适配） |
| 21 | `thread/metadata/update` | 缺少（未显式适配） |
| 22 | `thread/section/move` | 缺少（未显式适配） |
| 23 | `thread/settings/update` | 已显式适配 |
| 24 | `thread/memoryMode/set` | 缺少（未显式适配） |
| 25 | `memory/reset` | 缺少（未显式适配） |
| 26 | `thread/unarchive` | 缺少（未显式适配） |
| 27 | `thread/compact/start` | 缺少（未显式适配） |
| 28 | `thread/shellCommand` | 缺少（未显式适配） |
| 29 | `thread/approveGuardianDeniedAction` | 缺少（未显式适配） |
| 30 | `thread/backgroundTerminals/clean` | 缺少（未显式适配） |
| 31 | `thread/backgroundTerminals/list` | 缺少（未显式适配） |
| 32 | `thread/backgroundTerminals/terminate` | 缺少（未显式适配） |
| 33 | `thread/rollback` | 缺少（未显式适配） |
| 34 | `thread/revert` | 缺少（未显式适配） |
| 35 | `thread/list` | 已显式适配 |
| 36 | `project/list` | 缺少（未显式适配） |
| 37 | `project/read` | 缺少（未显式适配） |
| 38 | `project/create` | 缺少（未显式适配） |
| 39 | `project/import` | 缺少（未显式适配） |
| 40 | `project/update` | 缺少（未显式适配） |
| 41 | `project/move` | 缺少（未显式适配） |
| 42 | `project/delete` | 缺少（未显式适配） |
| 43 | `threadSection/list` | 缺少（未显式适配） |
| 44 | `threadSection/create` | 缺少（未显式适配） |
| 45 | `threadSection/update` | 缺少（未显式适配） |
| 46 | `threadSection/delete` | 缺少（未显式适配） |
| 47 | `thread/search` | 缺少（未显式适配） |
| 48 | `thread/searchOccurrences` | 缺少（未显式适配） |
| 49 | `thread/loaded/list` | 已显式适配 |
| 50 | `thread/read` | 已显式适配 |
| 51 | `thread/turns/list` | 已显式适配 |
| 52 | `thread/items/list` | 已显式适配 |
| 53 | `thread/inject_items` | 缺少（未显式适配） |
| 54 | `skills/list` | 缺少（未显式适配） |
| 55 | `skills/extraRoots/set` | 缺少（未显式适配） |
| 56 | `hooks/list` | 缺少（未显式适配） |
| 57 | `marketplace/add` | 缺少（未显式适配） |
| 58 | `marketplace/remove` | 缺少（未显式适配） |
| 59 | `marketplace/upgrade` | 缺少（未显式适配） |
| 60 | `plugin/list` | 缺少（未显式适配） |
| 61 | `plugin/search` | 缺少（未显式适配） |
| 62 | `plugin/installed` | 缺少（未显式适配） |
| 63 | `plugin/read` | 缺少（未显式适配） |
| 64 | `plugin/skill/read` | 缺少（未显式适配） |
| 65 | `plugin/share/save` | 缺少（未显式适配） |
| 66 | `plugin/share/updateTargets` | 缺少（未显式适配） |
| 67 | `plugin/share/list` | 缺少（未显式适配） |
| 68 | `plugin/share/checkout` | 缺少（未显式适配） |
| 69 | `plugin/share/delete` | 缺少（未显式适配） |
| 70 | `app/read` | 缺少（未显式适配） |
| 71 | `app/list` | 缺少（未显式适配） |
| 72 | `app/installed` | 缺少（未显式适配） |
| 73 | `fs/readFile` | 缺少（未显式适配） |
| 74 | `fs/writeFile` | 缺少（未显式适配） |
| 75 | `fs/createDirectory` | 缺少（未显式适配） |
| 76 | `fs/getMetadata` | 缺少（未显式适配） |
| 77 | `fs/readDirectory` | 缺少（未显式适配） |
| 78 | `fs/remove` | 缺少（未显式适配） |
| 79 | `fs/copy` | 缺少（未显式适配） |
| 80 | `fs/watch` | 已显式适配 |
| 81 | `fs/unwatch` | 已显式适配 |
| 82 | `skills/config/write` | 缺少（未显式适配） |
| 83 | `plugin/install` | 缺少（未显式适配） |
| 84 | `plugin/uninstall` | 缺少（未显式适配） |
| 85 | `turn/start` | 已显式适配 |
| 86 | `turn/settings/update` | 已显式适配 |
| 87 | `turn/steer` | 已显式适配 |
| 88 | `turn/interrupt` | 已显式适配 |
| 89 | `thread/realtime/start` | 缺少（未显式适配） |
| 90 | `thread/realtime/appendAudio` | 缺少（未显式适配） |
| 91 | `thread/realtime/appendText` | 缺少（未显式适配） |
| 92 | `thread/realtime/appendSpeech` | 缺少（未显式适配） |
| 93 | `thread/realtime/stop` | 缺少（未显式适配） |
| 94 | `thread/timeline/list` | 缺少（未显式适配） |
| 95 | `thread/realtime/listVoices` | 缺少（未显式适配） |
| 96 | `review/start` | 缺少（未显式适配） |
| 97 | `model/list` | 已显式适配 |
| 98 | `modelProvider/capabilities/read` | 缺少（未显式适配） |
| 99 | `experimentalFeature/list` | 缺少（未显式适配） |
| 100 | `permissionProfile/list` | 缺少（未显式适配） |
| 101 | `experimentalFeature/enablement/set` | 缺少（未显式适配） |
| 102 | `remoteControl/enable` | 缺少（未显式适配） |
| 103 | `remoteControl/disable` | 缺少（未显式适配） |
| 104 | `remoteControl/status/read` | 缺少（未显式适配） |
| 105 | `remoteControl/pairing/start` | 缺少（未显式适配） |
| 106 | `remoteControl/pairing/status` | 缺少（未显式适配） |
| 107 | `remoteControl/client/list` | 缺少（未显式适配） |
| 108 | `remoteControl/client/revoke` | 缺少（未显式适配） |
| 109 | `collaborationMode/list` | 缺少（未显式适配） |
| 110 | `mock/experimentalMethod` | 缺少（未显式适配） |
| 111 | `environment/add` | 缺少（未显式适配） |
| 112 | `environment/info` | 缺少（未显式适配） |
| 113 | `environment/status` | 缺少（未显式适配） |
| 114 | `mcpServer/oauth/login` | 缺少（未显式适配） |
| 115 | `config/mcpServer/reload` | 缺少（未显式适配） |
| 116 | `mcpServerStatus/list` | 已显式适配 |
| 117 | `mcpServer/resource/read` | 缺少（未显式适配） |
| 118 | `mcpServer/event/stream/start` | 已显式适配 |
| 119 | `mcpServer/event/stream/stop` | 已显式适配 |
| 120 | `mcpServer/tool/call` | 缺少（未显式适配） |
| 121 | `windowsSandbox/setupStart` | 缺少（未显式适配） |
| 122 | `windowsSandbox/readiness` | 缺少（未显式适配） |
| 123 | `account/login/start` | 缺少（未显式适配） |
| 124 | `account/bedrock/discover` | 缺少（未显式适配） |
| 125 | `account/bedrock/setup` | 缺少（未显式适配） |
| 126 | `account/login/cancel` | 缺少（未显式适配） |
| 127 | `account/logout` | 缺少（未显式适配） |
| 128 | `account/rateLimits/read` | 缺少（未显式适配） |
| 129 | `account/rateLimitResetCredit/consume` | 缺少（未显式适配） |
| 130 | `account/usage/read` | 缺少（未显式适配） |
| 131 | `account/workspaceMessages/read` | 缺少（未显式适配） |
| 132 | `account/sendAddCreditsNudgeEmail` | 缺少（未显式适配） |
| 133 | `feedback/upload` | 缺少（未显式适配） |
| 134 | `command/exec` | 缺少（未显式适配） |
| 135 | `command/exec/write` | 缺少（未显式适配） |
| 136 | `command/exec/terminate` | 缺少（未显式适配） |
| 137 | `command/exec/resize` | 缺少（未显式适配） |
| 138 | `process/spawn` | 缺少（未显式适配） |
| 139 | `process/writeStdin` | 缺少（未显式适配） |
| 140 | `process/kill` | 缺少（未显式适配） |
| 141 | `process/resizePty` | 缺少（未显式适配） |
| 142 | `config/read` | 缺少（未显式适配） |
| 143 | `externalAgentConfig/detect` | 缺少（未显式适配） |
| 144 | `externalAgentConfig/import` | 缺少（未显式适配） |
| 145 | `externalAgentConfig/import/recordHistory` | 缺少（未显式适配） |
| 146 | `externalAgentConfig/import/readHistories` | 缺少（未显式适配） |
| 147 | `config/value/write` | 缺少（未显式适配） |
| 148 | `config/batchWrite` | 缺少（未显式适配） |
| 149 | `configRequirements/read` | 缺少（未显式适配） |
| 150 | `account/read` | 缺少（未显式适配） |
| 151 | `getConversationSummary` | 缺少（未显式适配） |
| 152 | `gitDiffToRemote` | 缺少（未显式适配） |
| 153 | `getAuthStatus` | 缺少（未显式适配） |
| 154 | `fuzzyFileSearch` | 已显式适配 |
| 155 | `fuzzyFileSearch/sessionStart` | 缺少（未显式适配） |
| 156 | `fuzzyFileSearch/sessionUpdate` | 缺少（未显式适配） |
| 157 | `fuzzyFileSearch/sessionStop` | 缺少（未显式适配） |

## 4. 服务端反向请求（App Server → Client，需要响应）

| # | 方法 | Gateway 状态 |
|---:|---|---|
| 1 | `item/commandExecution/requestApproval` | 已显式适配 |
| 2 | `item/fileChange/requestApproval` | 已显式适配 |
| 3 | `item/tool/requestUserInput` | 已显式适配 |
| 4 | `mcpServer/elicitation/request` | 已显式适配 |
| 5 | `item/permissions/requestApproval` | 已显式适配 |
| 6 | `item/tool/call` | 已显式适配 |
| 7 | `account/chatgptAuthTokens/refresh` | 已显式适配 |
| 8 | `attestation/generate` | 已显式适配 |
| 9 | `currentTime/read` | 已显式适配 |

这组接口已全部出现于 Gateway 的生产代码。核心路由定义在 `shared/server-requests.ts`，浏览器响应经 `server/utils/gateway/realtime/server-request-response.ts` 回传 App Server；命令和文件审批另有专门的历史与 UI 处理。

## 5. 服务端通知（App Server → Client，无响应）

| # | 方法 | Gateway 状态 |
|---:|---|---|
| 1 | `error` | 已显式适配 |
| 2 | `thread/started` | 已显式适配 |
| 3 | `thread/status/changed` | 已显式适配 |
| 4 | `thread/archived` | 已显式适配 |
| 5 | `thread/deleted` | 已显式适配 |
| 6 | `thread/unarchived` | 已显式适配 |
| 7 | `thread/closed` | 已显式适配 |
| 8 | `thread/reverted` | 缺少（未显式适配） |
| 9 | `skills/changed` | 已显式适配 |
| 10 | `thread/name/updated` | 已显式适配 |
| 11 | `thread/goal/updated` | 已显式适配 |
| 12 | `thread/goal/cleared` | 已显式适配 |
| 13 | `thread/queue/changed` | 缺少（未显式适配） |
| 14 | `project/changed` | 缺少（未显式适配） |
| 15 | `thread/project/updated` | 缺少（未显式适配） |
| 16 | `thread/environment/connected` | 缺少（未显式适配） |
| 17 | `thread/environment/disconnected` | 缺少（未显式适配） |
| 18 | `thread/settings/updated` | 已显式适配 |
| 19 | `thread/tokenUsage/updated` | 已显式适配 |
| 20 | `turn/started` | 已显式适配 |
| 21 | `hook/started` | 已显式适配 |
| 22 | `turn/completed` | 已显式适配 |
| 23 | `hook/completed` | 已显式适配 |
| 24 | `turn/diff/updated` | 已显式适配 |
| 25 | `turn/plan/updated` | 已显式适配 |
| 26 | `item/started` | 已显式适配 |
| 27 | `item/autoApprovalReview/started` | 已显式适配 |
| 28 | `item/autoApprovalReview/completed` | 已显式适配 |
| 29 | `autoApprovalReview/strictReviewRequired` | 缺少（未显式适配） |
| 30 | `item/completed` | 已显式适配 |
| 31 | `rawResponseItem/completed` | 已显式适配 |
| 32 | `rawResponse/completed` | 已显式适配 |
| 33 | `item/agentMessage/delta` | 已显式适配 |
| 34 | `item/plan/delta` | 已显式适配 |
| 35 | `command/exec/outputDelta` | 缺少（未显式适配） |
| 36 | `process/outputDelta` | 缺少（未显式适配） |
| 37 | `process/exited` | 缺少（未显式适配） |
| 38 | `item/commandExecution/outputDelta` | 已显式适配 |
| 39 | `item/commandExecution/terminalInteraction` | 已显式适配 |
| 40 | `item/fileChange/outputDelta` | 缺少（未显式适配） |
| 41 | `item/fileChange/patchUpdated` | 已显式适配 |
| 42 | `serverRequest/resolved` | 已显式适配 |
| 43 | `item/mcpToolCall/progress` | 已显式适配 |
| 44 | `mcpServer/oauthLogin/completed` | 已显式适配 |
| 45 | `mcpServer/startupStatus/updated` | 已显式适配 |
| 46 | `mcpServer/event/stream/notification` | 已显式适配 |
| 47 | `account/updated` | 已显式适配 |
| 48 | `account/rateLimits/updated` | 已显式适配 |
| 49 | `app/list/updated` | 已显式适配 |
| 50 | `remoteControl/status/changed` | 已显式适配 |
| 51 | `externalAgentConfig/import/progress` | 已显式适配 |
| 52 | `externalAgentConfig/import/completed` | 已显式适配 |
| 53 | `fs/changed` | 已显式适配 |
| 54 | `item/reasoning/summaryTextDelta` | 已显式适配 |
| 55 | `item/reasoning/summaryPartAdded` | 缺少（未显式适配） |
| 56 | `item/reasoning/textDelta` | 已显式适配 |
| 57 | `thread/compacted` | 已显式适配 |
| 58 | `model/rerouted` | 已显式适配 |
| 59 | `model/verification` | 已显式适配 |
| 60 | `turn/moderationMetadata` | 已显式适配 |
| 61 | `model/safetyBuffering/updated` | 已显式适配 |
| 62 | `warning` | 已显式适配 |
| 63 | `guardianWarning` | 已显式适配 |
| 64 | `deprecationNotice` | 已显式适配 |
| 65 | `configWarning` | 已显式适配 |
| 66 | `fuzzyFileSearch/sessionUpdated` | 已显式适配 |
| 67 | `fuzzyFileSearch/sessionCompleted` | 已显式适配 |
| 68 | `thread/realtime/started` | 已显式适配 |
| 69 | `thread/realtime/itemAdded` | 缺少（未显式适配） |
| 70 | `thread/realtime/item/started` | 缺少（未显式适配） |
| 71 | `thread/realtime/item/transcript/delta` | 缺少（未显式适配） |
| 72 | `thread/realtime/item/completed` | 缺少（未显式适配） |
| 73 | `thread/realtime/transcript/delta` | 缺少（未显式适配） |
| 74 | `thread/realtime/transcript/done` | 缺少（未显式适配） |
| 75 | `thread/realtime/outputAudio/delta` | 缺少（未显式适配） |
| 76 | `thread/realtime/sdp` | 缺少（未显式适配） |
| 77 | `thread/realtime/error` | 已显式适配 |
| 78 | `thread/realtime/closed` | 已显式适配 |
| 79 | `windows/worldWritableWarning` | 已显式适配 |
| 80 | `windowsSandbox/setupCompleted` | 已显式适配 |

## 6. 客户端通知（Client → App Server，无响应）

| # | 方法 | Gateway 状态 |
|---:|---|---|
| 1 | `initialized` | 已显式适配 |

## 7. 第一阶段需要额外实现的 App Server 接口

本节只讨论 Gateway 目前缺少、并且第一阶段产品需要新增的 App Server 协议适配。用户系统、项目授权、业务 MCP 鉴权、容器隔离、审计和幂等属于平台能力，不属于 App Server 接口，因此不列入本节。

### 7.1 第一阶段最小必做

| 优先级 | 接口 | 用途 | 配套通知 | 验收要求 |
|---|---|---|---|---|
| P0 | `thread/archive` | 用户归档不再活跃的会话，保持历史列表可管理 | `thread/archived` 已适配 | 归档后从默认列表移除；归档列表可查询；多浏览器状态同步；失败原因可见 |
| P0 | `thread/delete` | 用户主动删除会话并满足数据生命周期要求 | `thread/deleted` 已适配 | 删除前确认；成功后清理路由、缓存和订阅；重复删除结果可控；其他浏览器同步退出该 Thread |
| P0 | `thread/unarchive` | 恢复误归档或需要继续处理的会话 | `thread/unarchived` 已适配 | 恢复后回到正常列表；可重新打开和继续 Turn；多浏览器同步 |

这三个请求的配套通知已经存在于 Gateway，因此主要新增工作是：Gateway 后端 Broker 方法、浏览器消息/HTTP 接口、前端操作入口、状态更新与真实 App Server E2E。

### 7.2 第一阶段按部署方案条件实现

| 条件 | 接口 | 何时需要 | 可以不实现的替代方式 |
|---|---|---|---|
| 第一阶段允许用户选择多个中国模型 Provider，并由 UI 动态判断能力 | `modelProvider/capabilities/read` | 需要展示 Provider 是否支持工具调用、推理等能力时 | 平台维护固定且经过验证的模型能力白名单 |
| 用户切换项目时需要在不重启个人 Agent 的情况下热更新 MCP 配置 | `config/mcpServer/reload` | 每个项目使用不同 MCP 地址或凭证，且要求无重启切换时 | 每用户/项目启动独立运行时，或修改配置后安全重启该用户的 App Server |
| 第一阶段允许管理员或用户选择 App Server Permission Profile | `permissionProfile/list` | UI 需要列出并选择可用权限配置时 | 平台服务端固定一个受控 Profile，不向普通用户开放选择 |

如果第一阶段继续采用“每用户一个 Agent、平台固定模型白名单、MCP 凭证在启动时注入、权限配置由服务端固定”的最小改动路线，那么条件接口可以全部延后，第一阶段只需新增 `thread/archive`、`thread/delete`、`thread/unarchive`。

### 7.3 第一阶段不需要因为业务 MCP 而额外实现的接口

- 不需要 `mcpServer/tool/call`：Agent 在 `turn/start` 执行过程中会通过 Codex Harness 调用已配置的 MCP 工具，Gateway 不必直接发起 MCP Tool Call。
- 不需要 `mcpServer/resource/read`：第一阶段知识库和业务数据都可以作为 MCP Tool 暴露；只有前端要直接浏览 MCP Resource 时才需要。
- 不需要 `mcpServer/oauth/login`：第一阶段由平台向每用户运行时注入短期项目凭证，不让浏览器直接持有业务 MCP OAuth 凭证。
- 不需要 `thread/shellCommand`、`command/exec` 或 `process/spawn`：业务运营 Agent 的写操作应通过受审计的业务 MCP 完成，不能把通用 Shell/Process 暴露给 Web 用户。
- 不需要 `project/*`：业务项目和 Codex Project 是不同领域对象；第一阶段以现有业务用户/项目系统为事实源。

## 8. 维护规则

1. 升级 `SUPPORTED_CODEX_VERSION` 时，先把 `third_party/openai-codex` 切到对应发布版本，再重新生成本矩阵。
2. 新增 App Server 请求时，同时实现响应 Schema、错误透传、浏览器消息类型、UI 状态和真实 E2E；只有字符串出现在代码里不算完成。
3. 新增服务端反向请求时，必须定义是否自动响应、是否需要用户确认、超时行为和断线后的恢复行为。
4. 新增通知时，必须明确它是仅记录日志、投影到 Thread 状态、更新历史 Item，还是触发用户可见提示。
5. 浏览器不得直接连接 App Server；所有方法继续经过 Nuxt Gateway 的鉴权、用户隔离和方法白名单。

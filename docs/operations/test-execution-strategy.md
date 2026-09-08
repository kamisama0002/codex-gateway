# 测试执行与去重策略

## 目标

在保持真实 MySQL、SSH、Codex App Server、WebSocket 和浏览器交互覆盖的前提下，减少重复构建、重复启动容器和无意义的全量测试。

核心原则：开发阶段按影响范围逐层扩大测试，完整 E2E 只针对最终待合入的代码树运行一次。

## 当前测试为什么慢

`pnpm test:e2e` 不只是启动 Playwright。每次执行都会：

1. 创建带随机后缀的独立 Docker Compose 项目。
2. 创建独立 MySQL 数据库、网络和数据卷。
3. 构建测试镜像和生产 Nuxt 输出。
4. 执行数据库迁移并创建测试用户。
5. 启动 Gateway、Runtime Manager、真实 SSH 目标、模型目标和浏览器预览入口。
6. 最后才按文件名或 `--grep` 过滤 Playwright 用例。

因此，下面的命令虽然只跑一个用例，仍会承担完整的构建和容器启动成本：

```bash
pnpm test:e2e -- tests/e2e/workspace-tool-sidebar.spec.ts --grep "docking a floating tool group"
```

文件和 `--grep` 过滤只减少浏览器测试时间，不减少前置生产构建时间。

测试 runner 的构建上下文必须包含 `tests/` 和 `playwright.config.ts`。如果它们被 `.dockerignore` 排除，旧镜像缓存可能暂时保留历史测试，而缓存失效后会直接出现 `No tests found`。runner 镜像应在构建阶段断言这两个入口存在，不能依赖历史缓存层。

每次 E2E 的 runner 镜像标签也必须随 Compose 项目唯一。只隔离容器、网络和数据库，但继续共享固定 runner 镜像标签，会让并发测试互相覆盖镜像：当前构建可能通过文件断言，执行时却被另一轮旧镜像替换。

并发 E2E 还必须隔离 Runtime Manager 身份密钥。Gateway 使用
`RUNTIME_MANAGER_SHARED_SECRET` 和数据库用户 ID 生成 runtime ID；每个独立测试库的首个用户 ID
通常都是 1，如果多个 Compose 项目共用同一个密钥，就仍会生成相同的 Agent 容器名和卷名。测试脚本应按
Compose 项目生成唯一密钥，并检查 Runtime Manager、Gateway 和 test runner 收到的是同一个值。

如果测试覆盖自定义登录账号，`E2E_GATEWAY_USERNAME` 和 `E2E_GATEWAY_PASSWORD` 必须同时传入
build runner 和 test runner。只让 build runner 创建新用户、但 Playwright 仍使用默认账号，会把登录失败误判为功能回归。

runner 镜像还必须在固定的 `COREPACK_HOME` 中准备 pnpm。生产构建完成后才让 test runner 临时访问
npm registry，会导致“构建成功、0 条测试、启动阶段网络超时”的假失败。镜像构建后应在
`--network none` 且切换运行时 `HOME` 的条件下验证 `pnpm --version`。

## 测试层级

| 层级         | 命令                                        | 适用范围                               | 是否需要每次运行                                      |
| ------------ | ------------------------------------------- | -------------------------------------- | ----------------------------------------------------- |
| 定向单测     | `pnpm test:unit <test-file>`                | 单个纯函数、Store、状态转换            | 每个行为改动先红后绿                                  |
| 前端单测     | `pnpm test:unit app`                        | 全部前端组件、Store 和纯逻辑           | 前端改动完成后一次                                    |
| 类型检查     | `pnpm typecheck`                            | Nuxt、E2E、数据库脚本类型              | 代码改动完成后一次                                    |
| 静态检查     | `pnpm lint:ox`                              | 应用、服务端、脚本和测试               | 代码改动完成后一次                                    |
| 改动文件格式 | `pnpm exec oxfmt --check <files>`           | 本次修改文件                           | 提交前一次                                            |
| 差异检查     | `git diff --check`                          | 空白错误和冲突残留                     | 提交前一次                                            |
| 定向 E2E     | `pnpm test:e2e -- <files> --grep <pattern>` | 真实 UI、Dockview、SSH、RPC 等特定行为 | 需要真实集成证明时，红一次、绿一次                    |
| 完整 E2E     | `pnpm test:e2e`                             | 完整生产构建和真实容器拓扑             | 最终合入前一次                                        |
| 完整单测     | `pnpm test:unit`                            | 包含 MySQL 集成单测                    | 仅在配置了 `MYSQL_TEST_ADMIN_DATABASE_URL` 的环境运行 |

## 按改动类型选择测试

### 只改文档

- 不运行单测、构建或 E2E。
- 只检查 Markdown 内容和 `git diff --check`。

### 纯前端函数、Store 或目录生成逻辑

- 定向单测红/绿。
- `pnpm test:unit app`。
- `pnpm typecheck`、`pnpm lint:ox`、改动文件格式检查。
- 不默认运行完整 E2E。

### Dockview、路由恢复、持久化、响应式布局或跨组件交互

- 前端测试集合。
- 将所有相关回归场景合并到一次定向 E2E 启动中。
- 最终待合入代码树再运行一次完整 E2E。

### SSH、App Server RPC、thread、WebSocket、上传、配置同步、数据库、Runtime Manager 或容器安全边界

- 定向测试用于快速定位。
- 合入前必须运行完整 E2E。
- 数据库单测需要真实 MySQL 测试连接，不能在缺少环境变量时反复运行并把环境失败当作代码失败。

## 红绿测试如何去重

每个行为最多保留以下执行：

1. 修复前运行一次，确认测试因目标行为缺失而失败。
2. 实现后运行一次，确认同一测试通过。
3. 所有相关行为完成后，将它们合并到同一次定向 E2E 中复核。
4. 最终代码树运行一次完整 E2E。

多个相关用例应合并成一次命令：

```bash
pnpm test:e2e -- \
  tests/e2e/workspace-tool-sidebar.spec.ts \
  tests/e2e/mobile-layout.mobile.spec.ts \
  --grep "floating tool group|open Files panel|mobile workspace header"
```

如果红测因定位器、夹具或测试数据错误失败，只修测试并重跑定向场景；不要因此启动完整 E2E。

## 明确不需要重复运行的情况

- 完整 E2E 已针对当前代码树通过，之后只执行 `git commit`、`git push` 或快进合并，没有修改文件。
- 只新增或修改说明文档。
- `pnpm test:e2e` 已完成生产 Nuxt 构建，不再为同一代码树单独重复 `pnpm build`。
- 全局格式检查只有已知、未触碰的基线文件失败时，只检查本次改动文件，不反复运行同一个已知失败命令。
- 本机没有 `MYSQL_TEST_ADMIN_DATABASE_URL` 时，不重复运行必然在初始化阶段失败的 MySQL 单测；交由带独立 MySQL 的容器环境验证。
- 定向 E2E 已覆盖同一行为时，不为每个文件分别启动一次 Compose；把文件和 `--grep` 条件合并到一个命令。
- 持久化布局测试不要硬编码 `host:project:thread` 之类的占位 scope；登录和配置恢复后应从当前导航状态生成真实 scope，避免验证了一个 Store 键，却观察另一个工作区界面。
- 通过 SSH 从 Windows 触发带复杂 `--grep` 正则的命令前，先验证多层 shell 的参数传递；不确定时直接运行单个 spec 文件，避免构建完成后才发现 `No tests found`。

## 推荐的日常流程

```text
定向单测红测
  -> 最小实现
  -> 定向单测绿测
  -> 必要时定向 E2E 红/绿
  -> 前端单测 + 类型 + Lint + 改动文件格式
  -> 完整 E2E 一次
  -> 提交、推送、合并（代码树不变则不重跑）
```

## 本次工具侧栏任务的重复情况

本次执行中：

- 第一次桌面红测包含两个测试夹具问题，需要校准后重跑；这是为避免按错误测试修改生产代码而保留的必要复核。
- 移动端标题红测单独启动了一次容器；它可以与校准后的桌面红测合并，是可避免的重复启动。
- 修复后的 3 个桌面场景和 1 个移动端场景已经合并到同一次定向绿测，做法正确。
- 工具栏恢复用例最初使用了占位 scope，并把 Dockview 的 `renderer: always` 内容节点当成组可见性；修正为真实 scope 和组头部控件后，避免继续围绕错误断言修改生产代码。
- 并发测试暴露了 runner 之外的 Runtime Manager 身份冲突；现在登录账号会传给两个 runner，Runtime Manager 密钥也按 Compose 项目隔离。
- 完整 E2E 只在最终代码树运行一次；之后若没有代码变化，提交、推送和快进合并不再重复测试。

## 后续可实现的 E2E 加速

当前脚本以完全隔离和自动清理为优先。若后续开发频率提高，可以增加显式的可复用测试会话：

1. 增加 `test:e2e:session:start`，构建一次并启动固定的开发测试栈。
2. 增加 `test:e2e:session:run -- <files> --grep <pattern>`，只重复执行 Playwright。
3. 增加 `test:e2e:session:stop`，统一清理容器、网络、数据卷和测试数据库。
4. 使用源码摘要校验构建产物；源码变化后拒绝复用旧产物。
5. 保留现有 `pnpm test:e2e` 作为 CI 和合入前的全新环境验证入口。

复用模式只能用于开发中的快速反馈，不能替代合入前的一次全新隔离环境 E2E。

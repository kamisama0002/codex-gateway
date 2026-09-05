# 多 Runtime 节点第一阶段设计

> 日期：2026-09-05
> 状态：书面设计已确认，进入分阶段实施
> 实施仓库：`codex-gateway`
> 实施分支：`codex/multi-runtime-nodes`

## 1. 背景

当前平台为每个用户运行一个长期 Codex App Server Docker 容器。Gateway、Runtime
Manager 和全部用户容器位于同一台物理机，Gateway 只配置一个
`RUNTIME_MANAGER_BASE_URL`，Runtime Manager 只操作本机 Docker Socket。Runtime
Manager 返回的 App Server 地址使用 Docker 内部容器名，因此 Gateway 还依赖与用户容器
共享同一个 Docker 网络。

用户量增加后，主要容量压力来自每用户 Agent 容器，而不是 Gateway。第一阶段把 Agent
容器分散到多台同一内网的服务器，并把 Gateway 主业务数据库从单机 SQLite 迁移到 MySQL
8。Gateway 仍保持单活，暂不引入 Redis、多 Gateway 所有权协调和共享文件系统。

## 2. 已确认决策

- 第一阶段采用单活 Gateway、MySQL 8、多 Runtime Manager 执行节点。
- Gateway 主业务数据全部迁移到 MySQL；生产请求路径不再使用 `node:sqlite`。
- Runtime Manager 节点本地的 nonce SQLite 只保存短期 HMAC 防重放 nonce，不承载用户、
  placement、配置或业务数据，因此本期继续保留。
- 同一内网中的每台执行服务器运行一个 Runtime Manager，并只管理本机 Docker。
- 用户第一次启动 Agent 时自动选择可用容量最大的节点。
- 管理员可以在首次创建前覆盖自动选择结果，也可以把节点设为 `draining`。
- 用户一旦分配节点便长期黏着；Gateway、Runtime Manager 或容器重启不改变节点归属。
- 节点不可用时不自动在其他节点创建容器，避免空工作区和双活。
- `/workspace` 和 `/codex-home` 使用节点本地显式目录，不引入 OSS、NFS、JuiceFS 或其他
  共享存储组件。
- 现有用户继续归属当前 CentOS 10 节点，旧 Docker named volumes 必须逐用户无损迁移，
  失败时恢复旧容器和旧 volumes。
- 另准备一个冷备 Gateway。冷备不同时提供业务流量，使用同一 MySQL 服务，并保存相同的
  配置、密钥和镜像版本。
- Redis 和多活 Gateway 保留为后续阶段，不在本设计实施范围内。

## 3. 目标

1. 支持配置多个 Runtime Manager 节点，并验证节点身份、协议版本、镜像能力和容量。
2. 新用户并发创建时只生成一个持久 placement，并按硬容量自动分配。
3. 后续所有 inspect、start、stop、restart、remove、stats、exec 和 App Server RPC 都固定
   路由到 placement 所属节点。
4. Gateway 不再依赖远端容器 DNS，通过节点 Runtime Manager Relay 连接 App Server。
5. 用户容器仍保持非 root、只读根文件系统、能力移除和资源限制。
6. Workspace 和 Codex home 在 Docker 容器、Docker daemon、Runtime Manager 和 Gateway
   重启后保持不变。
7. 保证当前线上用户和现有 Docker volumes 在切换过程中不丢数据。
8. 将现有 SQLite 数据无损导入 MySQL，保留用户 ID、密文、会话、Provider、授权、Runtime
   和审计记录。
9. 为 MySQL 增加一致性备份和可演练的冷备 Gateway 恢复流程。

### 3.1 交付拆分

总体设计按四个顺序依赖的里程碑交付，每个里程碑单独计划、测试、Review 和提交，不把全部
改造压成一次不可回滚的发布：

1. **MySQL 数据层**：async DAL、全部 repository 异步化、MySQL schema、真实 MySQL 测试、
   SQLite 导入和当前单节点生产切换。完成后 Runtime 行为仍是单节点。
2. **多节点路由**：runtime node registry、健康/容量、原子 placement、client pool、节点
   Relay 和当前节点回归。完成后才能注册第二个执行节点。
3. **本地目录存储**：新 Runtime 使用 node-local 目录、旧 named volume 迁移 CLI、逐用户
   迁移和回滚。旧 volumes 在确认前保留。
4. **第二节点与冷备**：部署第二个 Runtime Manager、开启新用户自动调度、配置 MySQL
   备份/binlog、准备 stopped standby Gateway 并演练恢复。

后一个里程碑只能在前一个里程碑的生产 smoke test 和回滚演练完成后开始。任何里程碑失败
都不得通过扩大下一阶段范围来绕过。

## 4. 非目标

- 不实现多个 Gateway 同时对外服务。
- 不保留 SQLite 与 MySQL 双写，不把 SQLite 放在 NFS 或由多个 Gateway 进程共同打开。
- 不引入 PostgreSQL、Redis、Kubernetes、Docker Swarm 或共享文件系统。
- 不实现节点故障后的自动跨机迁移或自动恢复。
- 不承诺物理磁盘损坏时 workspace 零数据丢失；本期只保证本地目录不随容器或 Docker
  服务重启而丢失。
- 不实现运行中进程、终端或 tmux 进程的跨节点迁移。
- 不支持一个用户同时运行多个托管 Agent 容器。
- 不改变浏览器的 managed host/project 协议，也不向普通用户暴露物理节点 ID、地址或密钥。
- 不开放远程 Docker API、任意镜像、任意宿主机路径或任意 Docker 命令。

## 5. 总体架构

```text
DataOps / Browser
        |
        | HTTPS + page WebSocket
        v
Single Active Codex Gateway
  - Authentication and authorization
  - MySQL durable state and placement authority
  - Runtime node scheduler
  - Runtime Manager client pool
  - Existing thread broker and realtime fan-out
        |
        | private HTTPS/WSS, per-node authentication
        |
        +-------------------+-------------------+
        |                   |                   |
        v                   v                   v
Runtime Manager A     Runtime Manager B     Runtime Manager C
  local Docker          local Docker          local Docker
  local data root       local data root       local data root
        |                   |                   |
   User 1 / User 3         User 2              User 4
```

冷备控制面：

```text
Active Gateway
  -> shared MySQL 8
  -> encrypted secret/config distribution
  -> stopped standby Gateway

Standby Gateway remains stopped until an explicit failover.
```

浏览器仍使用固定的逻辑 `MANAGED_RUNTIME_HOST_ID`。物理节点只存在于 Gateway 服务端的
placement 和 Runtime Manager 通信层，不改变现有 URL、thread key 或前端选择逻辑。

## 6. 数据模型

### 6.1 Runtime 节点

新增 `runtime_nodes`：

```text
id                         TEXT PRIMARY KEY
name                       TEXT NOT NULL UNIQUE
base_url                   TEXT NOT NULL UNIQUE
encrypted_shared_secret    TEXT NOT NULL
scheduling_state           TEXT NOT NULL  # active | draining | disabled
capacity_cpu_millis        INTEGER NOT NULL
capacity_memory_bytes      INTEGER NOT NULL
max_runtimes               INTEGER NOT NULL
minimum_free_disk_bytes    INTEGER NOT NULL
last_seen_at               TEXT
last_error                 TEXT
created_at                 TEXT NOT NULL
updated_at                 TEXT NOT NULL
```

规则：

- `id` 是创建后不变的服务端 opaque ID，不使用 IP、主机名或数组序号。
- `base_url` 必须是 Gateway 可达的私网 HTTPS 地址；测试环境可以显式允许隔离网络中的
  HTTP。
- 每节点使用独立 HMAC secret，通过现有 AES-256-GCM 配置加密能力保存。
- `draining` 节点不接收新用户，但继续服务已有 placement。
- `disabled` 节点不参与调度，已有用户访问时返回明确的节点不可用错误。
- 节点删除前必须确认没有任何 placement；不做级联删除或隐式迁移。

### 6.2 用户 Runtime placement

扩展现有 `user_agent_runtimes`：

```text
runtime_id                 TEXT NOT NULL UNIQUE
runtime_node_id            TEXT NOT NULL REFERENCES runtime_nodes(id)
placement_generation       INTEGER NOT NULL DEFAULT 1
workspace_key              TEXT NOT NULL UNIQUE
reserved_cpu_millis        INTEGER NOT NULL
reserved_memory_bytes      INTEGER NOT NULL
reserved_pids              INTEGER NOT NULL
```

现有的 `user_id UNIQUE` 和固定逻辑 `host_id` 保持不变：前者继续保证一个用户一个 Runtime，
后者继续表示前端逻辑 managed host，而不是物理服务器。

`runtime_id` 对同一用户保持稳定，不把 node ID 或 generation 编入 runtime ID。物理归属和
防双活分别由 `runtime_node_id` 与 `placement_generation` 表达。现有用户使用当前密钥派生的
runtime ID 回填；上线后新增独立、长期稳定的 `RUNTIME_IDENTITY_SECRET`，初始值必须与当前
`RUNTIME_MANAGER_SHARED_SECRET` 相同，避免旧容器身份改变。节点认证 secret 与 identity
secret 从此分离。

`workspace_key` 是随机生成的 opaque 值，只用于节点本地目录名，不使用明文 DataOps 用户
ID、用户名或可读业务标识。

### 6.3 Placement 事实源

- MySQL placement 是唯一权威；不能通过逐节点扫描来决定用户归属。
- Docker labels 是节点侧实际状态，用于校验和恢复，不反向覆盖 MySQL placement。
- `container_id` 只有结合 `runtime_node_id` 才有意义。
- Runtime Manager 必须校验 `runtime_id`、完整 `user_hash`、`node_id` 和
  `placement_generation` labels。
- 同一节点发现同一 runtime/generation 多个容器时进入冲突状态，不选择第一个继续运行。

## 7. 自动调度与黏着路由

### 7.1 Eligible 节点

新 placement 只能选择同时满足以下条件的节点：

- `scheduling_state = active`；
- 最近一次健康检查在 freshness 窗口内；
- Manager 认证、协议版本和目标 Agent 镜像兼容；
- 预留后的 CPU、内存和 runtime slot 足够；
- 本地数据根目录可写且剩余磁盘高于安全阈值。

瞬时 CPU 和 free memory 只用于次级排序，不能代替硬容量 reservation。

### 7.2 评分

对每个 eligible 节点计算 CPU、内存和 slot 的剩余比例，优先选择最小瓶颈剩余比例最大的
节点；再使用磁盘余量和稳定 node ID 打破平局。算法必须确定性，节点列表顺序变化不能让
同一输入得到随机结果。

管理员覆盖只允许选择 eligible 节点。若管理员确实要分配到 draining 节点，必须使用单独
的强制操作并记录审计，普通首次启动 API 不接受 caller-supplied node ID。

### 7.3 原子创建

Gateway 使用 MySQL InnoDB 事务和行锁完成：

1. 再次检查用户尚无 placement。
2. 读取节点健康快照和已有 reservation。
3. 选择节点。
4. 创建 runtime ID、workspace key、generation 和 reservation。
5. 提交 placement。

候选节点通过 `SELECT ... FOR UPDATE` 锁定，`user_id` 唯一约束作为最终并发防线。网络
provision 在数据库事务提交后执行，不能在 MySQL 事务中等待 Runtime Manager。
provision 失败时保留原 placement 并标记 degraded；重试只能访问同一节点，禁止因 timeout
静默换节点。

### 7.4 后续路由

所有 Runtime 操作先按 `user_id` 读取 placement，再通过 `runtime_node_id` 从
`RuntimeManagerClientPool` 选择 client。不存在全节点广播、随机重试或“哪个节点找到容器就
用哪个”的 fallback。

## 8. 节点健康与容量

Runtime Manager 新增只读 node status 接口，返回：

- node ID、Manager 版本、协议版本；
- Docker daemon 可用状态；
- 支持的镜像 alias/version；
- 当前 managed runtime 数和运行数；
- 数据根目录是否可写、总空间和可用空间；
- 当前 Runtime Manager uptime。

Gateway 定期采样并更新 `last_seen_at/last_error`。状态解释：

- `healthy`：允许新 placement 和已有用户访问。
- `suspect`：健康结果过期，不接新用户；已有请求可做有限同节点重试。
- `unavailable`：拒绝 Runtime 操作并向用户返回可操作错误。
- `draining`：健康但不接新用户，已有用户保持黏着。
- `disabled`：管理员停用。

节点健康变化不得修改用户 placement。

## 9. Runtime Manager Client Pool

Gateway 用稳定 node ID 管理 client：

```ts
interface RuntimeNodeClientRegistry {
  get(nodeId: string): RuntimeManagerClient;
  invalidate(nodeId: string): void;
  probe(nodeId: string): Promise<RuntimeNodeHealth>;
}
```

- client 只持有单节点 base URL 和该节点 secret。
- 节点配置 revision 变化后废弃旧 client，关闭旧 relay/HTTP 资源。
- HTTP timeout、有限重试和熔断按节点隔离，一个节点故障不能拖慢其他节点。
- 生命周期操作只能对 placement 节点重试。
- `RUNTIME_MANAGER_BASE_URL` 单值配置只用于首次迁移时创建默认节点，完成迁移后以数据库
  node registry 为准。

## 10. App Server WebSocket Relay

当前 `ws://<containerName>:4500` 只在同一 Docker 网络可达。第一阶段改为：

```text
Gateway
  -> wss://runtime-node/v1/runtimes/<runtimeId>/generations/<generation>/rpc
  -> Runtime Manager validates Gateway request and placement generation
  -> ws://local-container:4500 with container service token
```

约束：

- Runtime Manager 处理 WebSocket upgrade，并在节点内完成双向 frame 转发。
- 容器 service token、容器 DNS 和 Docker socket 永不离开节点，也不返回浏览器。
- Gateway 的 WebSocket upgrade 使用 timestamp、nonce、空 body hash、完整 path 和 HMAC
  签名；generation 位于签名 path 中。
- 节点 nonce store 继续使用本地 SQLite，每节点 secret 独立，避免跨节点 replay 域。
- 生产 Manager 直接使用 Node HTTPS/WSS 证书，不额外部署代理组件；防火墙只允许 active
  Gateway 和 cold-standby Gateway 地址访问 Manager 端口。
- 测试环境只有在显式配置时允许隔离 Docker 网络中的 HTTP/WS。
- Relay 上游或下游关闭必须透传明确 close/error，Gateway 使用现有重连和线程恢复逻辑，
  不伪造成功状态。
- Manager 发现请求 generation 低于节点已接受 generation 时拒绝连接和生命周期写操作。

## 11. 节点本地 Workspace

每个 Runtime Manager 配置：

```text
RUNTIME_NODE_ID=<stable-node-id>
RUNTIME_NODE_DATA_ROOT=/srv/codex-gateway/runtimes
```

每用户目录：

```text
/srv/codex-gateway/runtimes/<workspaceKey>/workspace
/srv/codex-gateway/runtimes/<workspaceKey>/codex-home
```

规则：

- 请求只携带 opaque `workspaceKey`，不能传入宿主机绝对路径。
- Manager 对根目录、目标目录和父目录执行 realpath/lstat 校验，拒绝 `..`、绝对路径、
  symlink escape 和已存在的异常文件类型。
- 新目录由 Manager 创建，属主固定为容器 UID/GID `10001:10001`。
- Agent 仍以 bind mount 方式只挂载自己的两个目录；根文件系统保持只读。
- 容器和目录 labels/metadata 包含 runtime ID、workspace key、node ID 和 generation，不包含
  用户名或明文用户 ID。
- 第一阶段不实现共享目录，不允许两个节点同时挂载同一个 workspace。
- 第一阶段至少检查节点级 minimum free disk；每用户硬盘配额留作后续增强。

## 12. 现有 Docker Volume 无损迁移

迁移不在用户访问请求中隐式执行。提供管理员 CLI，对当前节点上的用户逐个迁移：

1. `--dry-run` 解析 runtime/container/volume labels、目标路径、容量和冲突，不写数据。
2. 阻止该用户新 turn，并确认没有 active turn。
3. 停止用户容器，记录完整旧容器 inspect 和两个 volume 名称。
4. 创建同一文件系统中的 staging 目录。
5. 使用固定版本的受限 helper 容器复制 `workspace` 和 `codex-home`，保留权限、mtime、
   隐藏文件和 symlink，不跟随越界 symlink。
6. 生成源和 staging 的文件清单、大小及内容 hash，并要求一致。
7. fsync 后把 staging 原子 rename 为最终 workspace key 目录。
8. 使用相同 runtime ID、node ID 和 generation 重建容器，只把 mount 改为本地目录。
9. 启动容器，完成 App Server 版本、schema、thread list 和 workspace 文件探测。
10. 成功后提交迁移审计；旧 volumes 标记 quarantine，至少保留到人工确认和备份完成。

任一步失败：

- 目标目录不能成为 active storage；
- 使用已记录的旧 mounts 恢复并启动原容器；
- 不删除旧 volumes；
- 保存安全错误码和审计，不记录文件内容、Token 或密钥。

上线时先迁移一个测试用户，再迁移普通用户，最后迁移管理员用户。旧 volumes 的删除不属于
自动部署步骤，必须由单独、明确的清理操作执行。

## 13. MySQL 数据层、迁移与冷备

### 13.1 MySQL 运行边界

Gateway 主库使用 MySQL 8/InnoDB、`utf8mb4` 和 UTC。可以复用已有 MySQL 集群，但必须
建立独立 `codex_gateway` database、独立账号和最小权限，不能与 DataOps/Dinky 业务表
混用。自带 Compose 为开发和单机测试提供 MySQL 服务；生产通过 `DATABASE_URL` 连接可独立
备份和恢复的 MySQL。

自建 MySQL 至少配置 `innodb_flush_log_at_trx_commit=1` 和 `sync_binlog=1`。只把单实例
MySQL 放在 active Gateway 同一台物理机上不能形成高可用；冷备方案要求 MySQL 位于两台
Gateway 都可访问的位置，或有已经演练的 MySQL 备份恢复路径。

Runtime Manager 的 nonce SQLite 与 Gateway MySQL 分离。它只保存短 TTL 的 HMAC nonce，
节点重启后丢失不会丢用户、placement、workspace、配置或审计；每节点 secret 独立，因此
不需要跨节点共享 nonce store。

### 13.2 异步数据访问层

当前同步 `DatabaseSync` 不能包装网络数据库后继续冒充同步接口。第一阶段使用
`mysql2/promise` 和薄的、可注入的 async DAL，不引入大型 ORM：

```ts
interface GatewayDb {
  one<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
  many<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  execute(sql: string, params?: SqlValue[]): Promise<DbWriteResult>;
  transaction<T>(work: (tx: GatewayDb) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
```

数据库连接、参数化查询、事务、错误归一化、时间和整数 mapping 位于 DAL；业务 SQL 保留在
按领域拆分的 repository：user/session/config、external identity、provider、runtime、audit、
tmux monitor 和 runtime nodes。所有 repository 显式注入 `GatewayDb`，禁止模块 import 时
创建数据库连接。

认证 middleware、WebSocket 首帧认证、用户配置加载、Provider Proxy、Runtime Service、
tmux poller 和后台清理全部改为真实 `async/await`。不能使用阻塞等待把 MySQL Promise
重新伪装为同步调用。

用户加密配置继续以每用户一行的 encrypted JSON 保存，第一阶段不拆成大量关系表；新增
单调 `revision`，更新使用 compare-and-swap，避免未来多 Gateway 时出现静默覆盖。

### 13.3 MySQL schema migration

MySQL schema 使用独立 migration CLI，不由每个 Web 进程在首次请求时隐式执行：

- migration 有版本、checksum 和 applied timestamp；
- runner 使用 MySQL `GET_LOCK` 防止并发执行；
- DDL 按 expand/backfill/contract 前向演进；
- 所有表使用明确外键、唯一约束和索引；
- JavaScript 可见 ID 使用安全范围内的 unsigned integer，时间第一阶段保持固定 UTC ISO
  字符串，减少与现有逻辑的行为差异；
- SQLite partial unique index、`ON CONFLICT`、`BEGIN IMMEDIATE`、`lastInsertRowid`、
  `STRICT` 和 `datetime('now')` 必须按 MySQL 语义重新实现，不能机械替换。

`tmux_monitors` 的 active-only 唯一性使用生成列加唯一索引或独立 active key，必须有两个
并发 poller 的数据库测试证明约束有效。

### 13.4 现有 SQLite 数据导入

提供独立、幂等且支持 `--dry-run` 的 SQLite-to-MySQL 导入 CLI。导入逻辑不进入 MySQL
schema migration，也不在 Gateway 启动时自动运行。

切换流程：

1. 保持旧 Gateway 单实例并进入维护模式，停止新登录和全部写操作。
2. 使用 SQLite online backup API 生成一致性只读源副本并执行 `PRAGMA quick_check`。
3. 在空 MySQL database 上运行目标 schema migration。
4. 按外键顺序导入 users、sessions/config/runtime/audit、providers/models/grants、external
   identities/contexts、tmux monitors，原样保留主键、token hash 和加密 blob。
5. 重置各表 auto increment，并验证每表行数、主键集合、FK orphan、唯一约束和抽样密文
   解密。
6. 用 MySQL 配置启动一个 Gateway，验证密码登录、DataOps SSO、配置、Provider、模型授权、
   Runtime placement、审计和 tmux。
7. 验证成功后切换入口；旧 SQLite 文件只读归档，不再接受写入。

不做 SQLite/MySQL 双写。切换后若 MySQL 已接受新写入，不能直接切回旧 SQLite；必须恢复
MySQL 备份/binlog，或使用经过验证的 MySQL-to-SQLite 回退导出。这个不可逆边界必须在上线
runbook 中明确确认。

### 13.5 MySQL 备份与冷备 Gateway

MySQL 使用一致性逻辑/物理备份、binlog 和恢复演练实现数据保护。最低要求：

- 定期 `--single-transaction` 全量备份；
- 连续 binlog 或满足业务 RPO 的增量备份；
- 备份存放在另一台物理机，不覆盖最近成功备份；
- 定期恢复到临时 database，验证表级行数、约束和抽样密文解密；
- 监控最后成功时间、备份大小、binlog 连续性和恢复演练结果。

以下恢复材料必须一起管理：

- MySQL backup 和 binlog；
- `CODEX_GATEWAY_CONFIG_SECRET`；
- `RUNTIME_IDENTITY_SECRET`；
- DataOps SSO secret；
- 每节点加密通信配置或可重新注入的节点 secret；
- 当前 Gateway/Runtime Manager/Agent 镜像版本和部署配置。

密钥不写进数据库备份、日志或仓库。冷备 Gateway 使用相同 secrets、同版本镜像和同一
MySQL，但默认停止。

冷备恢复流程：

1. 确认 active Gateway 已停止或被网络隔离，禁止双活。
2. 验证 MySQL 可用；若 MySQL 同时故障，先按备份/binlog 恢复并完成一致性校验。
3. 在 standby 恢复相同密钥和同版本部署配置。
4. 启动 standby Gateway。
5. 探测全部 Runtime Manager 节点。
6. 通过 MySQL placement 重连已有用户 Runtime；App Server 仍是 thread 事实源。
7. 切换 DataOps/Nginx 入口。

## 14. 管理 API 与界面

新增管理员能力：

- 列出节点、健康、版本、容量、reservation、运行 Runtime 数和磁盘余量。
- 添加节点并测试连接。
- 修改节点名称、容量和调度状态。
- 查看每个用户的 node placement、generation 和 Runtime 状态。
- 首次创建前设置 node override。
- 对节点执行 `drain`，但不自动迁移已有用户。
- 启动单用户 storage migration dry-run 和明确确认后的执行。

普通用户：

- 不看到节点 IP、node ID、容量或其他用户数量。
- 节点不可用时看到明确的“执行环境暂不可用”，可重试但不能选择其他节点绕过 placement。
- 原有聊天、模型、审批、文件和 terminal 界面保持不变。

浏览器 API 只能提交固定业务动作，不能提交 Manager URL、shared secret、宿主路径、
container ID、raw runtime ID 或任意 Docker 参数。

## 15. 安全边界

- Runtime Manager 继续是唯一持有本机 Docker Socket 的服务。
- Docker Socket 不通过 TCP、SSH tunnel 或反向代理暴露给 Gateway。
- 每节点 secret 独立，节点移除时可单独轮换，不改变用户 runtime identity。
- Manager API 和 Relay 使用 HTTPS/WSS；证书、secret 和 capability token 不进入日志。
- 容器仍使用 UID/GID 10001、`ReadonlyRootfs`、`CapDrop: ALL`、
  `no-new-privileges`、CPU/内存/PID 限制和内部 Agent 网络。
- Provider Proxy 改为所有 Runtime 节点可达的私网 HTTPS 地址；Runtime token 仍绑定
  user、runtime、provider 和 model。
- 对 node、placement、drain、storage migration 和失败恢复写入管理员审计。
- Manager 只接受 allow-listed lifecycle、status、stats、exec 和 relay 操作，不增加任意
  Docker 控制接口。

## 16. 故障语义

### 16.1 Runtime Manager 或节点不可达

- 已有 placement 不变。
- 不在其他节点 provision。
- Runtime 标记 degraded，用户看到节点不可用错误。
- 节点恢复后访问原 runtime，必要时在原节点启动原容器。

### 16.2 Docker daemon 或容器重启

- 节点本地目录不受影响。
- Manager 根据 placement 和 Docker labels 查找容器；容器停止则在同节点启动。
- 容器缺失但本地目录和 generation 匹配时，可在同节点幂等重建。
- 目录缺失时禁止创建空目录冒充恢复成功，进入人工恢复状态。

### 16.3 Gateway 重启

- 从 MySQL 恢复用户配置、node registry 和 placement。
- 重新探测节点并连接原 Runtime。
- thread 历史以 App Server 为事实源，Gateway 内存 cache 可以重建。

### 16.4 Gateway 主机故障

- 冷备 Gateway 不自动双活接管。
- 运维确认旧实例隔离后按恢复 runbook 启动冷备并切换入口。
- MySQL 正常时冷备直接连接同一数据库；MySQL 同时故障时先按 backup/binlog 恢复。
- workspace 仍在各执行节点，不随 Gateway 主机切换。

### 16.5 节点磁盘故障

- 第一阶段不承诺自动恢复或零数据丢失。
- 不在新节点创建空 workspace。
- 管理员从可用的节点级备份或人工副本恢复后，才允许显式 placement migration。

## 17. 发布与回滚

按以下顺序灰度：

1. 建立 async DAL、MySQL schema migration 和真实 MySQL 测试环境，生产仍运行旧 SQLite。
2. 完成所有 repository 和请求链的异步化，运行 SQLite-to-MySQL import dry-run。
3. 进入维护窗口，备份 SQLite、导入 MySQL、校验并把当前单节点 Gateway 切到 MySQL。
4. 增加 node registry 和 placement，只注册当前本机节点，行为保持单 Runtime 节点。
5. 分离 `RUNTIME_IDENTITY_SECRET` 和本机 Manager secret，验证现有 runtime ID 不变。
6. 部署 node status 和 WebSocket Relay，当前 Gateway 先通过 Relay 访问本机 Runtime。
7. 增加本地目录 storage 和迁移 CLI；只迁移一个测试用户并演练回滚。
8. 逐用户迁移当前三个长期 Runtime，旧 volumes 保留 quarantine。
9. 在第二台服务器部署同版本 Runtime Manager、Agent 镜像和本地 data root。
10. 管理员添加并探测新节点，先用测试用户 override 验证。
11. 开启自动调度，只影响尚无 placement 的新用户。
12. 部署 MySQL backup/binlog 和 cold-standby runbook，完成一次实际恢复演练。

回滚边界：

- MySQL 尚未接受生产写入前，可以恢复旧 Gateway 和 SQLite；SQLite 源文件保持只读归档。
- MySQL 已接受生产写入后，不能直接切回旧 SQLite；优先从 MySQL backup/binlog 恢复或
  前向修复，反向导出必须使用单独验证过的工具。
- 新节点尚无 placement 时，可以回滚到仍支持 MySQL 的上一 Gateway 阶段。
- 已有远程节点 placement 后，旧 Gateway 无法连接远程容器，不能直接整体回滚；必须先停止
  新用户创建并使用新版本迁回/恢复用户，或前向修复。
- storage migration 失败时使用旧 volumes 原地回滚；成功后旧 volumes 在人工确认前不删。
- Identity secret 不能回滚为不同值。

## 18. 测试设计

### 18.1 Unit

- 节点 schema、secret 加密和 admin authorization。
- scheduler eligibility、容量 reservation、确定性评分和 admin override。
- 两个并发首次请求只创建一个 placement。
- placement 存在后节点列表变化、负载变化和节点故障都不改变归属。
- client pool 按 node 隔离、配置 revision 后失效、同节点有限重试。
- generation 和 identity label 校验，重复容器冲突时 fail closed。
- 本地路径 realpath、symlink escape、异常文件和跨用户 workspace key 拒绝。
- async DAL、MySQL repository、事务 rollback、连接失败和 pool shutdown。
- MySQL schema migration 的 checksum/并发 runner，以及 SQLite import dry-run、幂等和校验。
- 用户配置 revision compare-and-swap，冲突不得静默覆盖。

### 18.2 Runtime Manager integration

- node status 使用真实 Docker daemon 和 data root。
- lifecycle 只创建固定 bind mounts，不接受 caller-supplied host path。
- Relay 使用真实 Agent App Server，Manager 内部注入 service token。
- 无效 HMAC、过期 timestamp、重放 nonce、错误 generation 和跨 runtime 请求均拒绝。
- Manager restart 后通过 Docker labels 和本地目录恢复 runtime。

### 18.3 真实 Docker E2E

扩展现有容器化 E2E，运行两个独立 Runtime Manager 节点：

- 使用真实 MySQL 8，覆盖 clean migration、SQLite fixture import 和 Gateway 重启。
- 两个节点容量均为 1，并发创建两个新用户后分别落到两个节点。
- Gateway 重启和节点列表换序后，用户仍连接原节点和原 thread。
- 节点 A draining/unavailable 时，新用户只选 B，A 的已有用户不迁移。
- B 满载时返回明确 capacity 错误，不在 A draining 节点绕过规则。
- 同一用户两个浏览器仍共享正确的 thread/RPC 状态。
- turn、steer、interrupt、approval、文件、terminal 和 reconnect 通过跨节点 Relay 工作。
- 两个用户的本地目录互不可见，路径逃逸测试被拒绝。
- 预置旧 named volumes 的隐藏文件、二进制、权限和 thread history；迁移后 manifest、
  内容和历史一致。
- 在复制、rename、容器重建和 probe 各阶段注入失败，原容器/volumes 始终可恢复。
- active Gateway 故障后，冷备连接同一 MySQL 并恢复 placement 与节点路由。

### 18.4 完成门槛

- `pnpm test:unit`
- 真实 MySQL 8 repository/integration tests
- Nuxt typecheck
- E2E TypeScript typecheck
- Oxlint 和格式检查
- `git diff --check`
- 两节点真实容器化 E2E
- 当前 CentOS 10 节点上的单用户迁移、回滚和 Gateway cold-restore smoke test

## 19. 验收标准

1. 管理员可以添加至少两个 Runtime Manager 节点并看到真实健康和容量。
2. 首次启动的用户自动选择 eligible 节点，数据库只产生一个 placement。
3. 同一用户后续始终连接同一节点，节点故障时不会在其他节点创建空 Runtime。
4. Gateway 不再解析或连接远端容器 DNS，App Server RPC 全部经过对应 Manager Relay。
5. 浏览器、日志和普通 API 不泄露 node secret、service token、宿主路径或其他用户信息。
6. 容器和 Docker daemon 重启后，workspace、Codex home 和 thread history不变。
7. 当前三个长期 Runtime 可逐个从 named volumes 迁到本地目录，验证失败可恢复旧容器。
8. SQLite-to-MySQL 导入通过行数、主键、外键、唯一约束和抽样密文校验；冷备 Gateway 能
   从 MySQL 恢复用户、配置、模型授权和 placement。
9. 新节点满载、draining、离线、证书错误和版本不兼容均产生明确、可操作且不跨节点重试的
   错误。
10. 第一阶段使用 MySQL，但不引入 Redis、共享文件系统或 active-active Gateway。

## 20. 后续演进

第一阶段稳定后再单独设计：

1. 为用户配置 revision 增加跨 Gateway cache invalidation。
2. 引入 Redis user-owner lease、fencing、member directory 和少量 Pub/Sub。
3. 解决同一用户的页面 WebSocket、SSH/RPC、terminal、preview 和后台任务单 owner。
4. 在统一入口后运行多个 active Gateway，并演练 owner failure takeover。
5. 根据实际 RPO/RTO 再选择节点本地备份、OSS snapshot、NFS/JuiceFS 或其他 workspace
   灾备方案。

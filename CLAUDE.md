# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Green Diva Homepage —— Next.js 16 App Router 社区平台，Prisma + Postgres（本地与生产统一），Tailwind v4，中英文 i18n。

> `AGENTS.md` 与本文件保持一致。修改其一时请同步另一个，避免漂移。

## 常用命令

```bash
npm run dev          # 开发
npm run build        # 生产构建
npm start            # 启动生产
npm run lint         # ESLint
npm run type-check   # tsc --noEmit
npm run db:push      # 同步 schema 到 DB（先确保 brew services start postgresql@16）
npm run db:seed      # 写入示例数据（生产环境拒绝执行，需 ALLOW_PROD_SEED=1 强行）
npx prisma generate  # 手动重新生成 client（postinstall 已自动执行）
```

无测试套件；改动需自行 `npm run type-check && npm run lint && npm run build` 验证。**注意顺序**：`type-check` + `lint` 可与 dev 并行，但 `build` 会写 `.next/` 覆盖 dev chunks（详见"开发缓存"段），跑前先停 dev 进程。

## 架构要点（跨文件理解）

**鉴权链路** —— 三段串联，改任一段都需联动：
1. `middleware.ts`：全局闸门，自身分三步——① 公开白名单 exact match：`/login`、`/api/auth/login`、`/api/locale`、`/sacred-terms`、`/privacy-covenant`、`/favicon.ico`（**项目硬规约：所有路由默认要求登录**；`PUBLIC_PREFIXES` 必须保持空数组，绝不再引入通配前缀——曾出过 `/relic-collection` 与 `/api/relics` 被整段公开的事故；新增公开路由先与用户确认，再仅以 exact match 加入 `PUBLIC_PATHS`）；② 校验 `gd_session` cookie 存在；③ 对 `/api/*` 的 POST/PUT/PATCH/DELETE 做 CSRF 校验（`Origin`/`Referer` 主机匹配 host 才放行）。另有 `STATIC_PREFIXES = ["/_next", "/fonts", "/images", "/videos"]` 直通（详见"资源与性能"段）。Edge runtime 不能 import Prisma，DB session 过期判定只能在下层做。
2. `lib/auth.ts`：暴露 `requireUser()` / `requireAdmin()`，所有写操作 API route 必须经过它。管理员判定 = `user.level >= ADMIN_LEVEL`（=100），**没有** `ADMIN_TOKEN` 环境变量，纯靠 DB 中的 level 字段。续期失败已 try/catch 记日志（不再静默吞）。
3. 登录流：POST `/api/auth/login` 传用户 token → 创建 Session 行 → 写 `gd_session` HttpOnly cookie。Session 7 天有效，支持滑动续期。**速率限制**：每 IP 60 秒内 5 次失败后返回 429，模式抄自 `app/api/vault/unseal/route.ts`。

**i18n 边界** —— Server Component 用 `lib/i18n/server.ts`，Client Component 用 `lib/i18n/client.tsx`，**两者不可混用**。语言偏好存 `locale` cookie，由 `/api/locale` 切换；字典在 `lib/i18n/dictionaries/{en,zh}/`。

**数据模型**（详见 `prisma/schema.prisma`）：
- `User` —— 含 RPG 属性字段（level/attack/defense/hp/agility/luck/specialAttributes），`SkillsRadar` 组件读这些字段渲染。
- `Activity` —— 用户动态，正文 ≤ 280 字符（`lib/validators.ts` 强制），关联 `User`。POST 接口对最近 5 秒内同 `userId+content` 自动去重（幂等），前端不要假定每次 POST 都新建。
- `Session` —— 登录会话。
- `Agent` —— `/agent-control` 模块的 workflow / agent 实体，关键字段：`mode`（`MECHANICAL` 黄色 / `AUTONOMOUS` 青绿）、`avatarUrl` **NOT NULL**、4 项派生 stats（`chaosLevel/costTier/activityLevel/stabilityLevel`，本期都 0% 占位）、`pipelineConfig` Json?（machine 中央槽 workflow 调度）、`dispatcherConfig` Json?（agent 中央槽 orchestrator 调度）、`deployedAt`（草稿 vs 已部署）。详见下方"Agent Control 装备界面"段。
- `Skill` —— 可装备的能力定义（level 1-6，icon = Material Symbols 名）。CRUD 在 `/agent-control?tab=skills`。**两组类型字段并存**：① `kind` (PASSIVE/ACTIVE/ULTIMATE) 是**纯装饰**（仅 [`SkillLibrary.tsx`](app/agent-control/components/SkillLibrary.tsx) 用于徽章配色，零 runtime 语义）；② `handlerKind` (HTTP_API/LLM_PROMPT/MCP_SERVER/INTERNAL) 是 **runtime 路由字段**（2026-05-07 落地，Phase 1），决定 [`lib/skills/registry.ts`](lib/skills/registry.ts) 派给哪个 handler。同时存的字段还有 `handlerConfig` Json（每个 handler 自己定义 shape）+ `inputSchema/outputSchema` Json?（JSON Schema，invoke 时校验 IO + 给 Orchestrator 转 LLM tool 定义）。详见 [docs/skill-handler-system.md](docs/skill-handler-system.md)。
- `AgentJob` —— async 调用历史（2026-05-07 落地，Phase 2），与 `RelicProcessingJob` 同模式。`mode` 字段是调用时刻的 agent.mode 快照（防 retry 飘移），`runLog` Json 是每步执行轨迹（数组），`maxAttempts=3`，状态机 `PENDING → RUNNING → SUCCESS|FAILED`。Crash recovery 由 [`lib/server-init.ts::ensureServerInit()`](lib/server-init.ts) 统一处理（与 RelicProcessingJob 同入口，10 分钟阈值）。
- `AgentSkillEquip` —— Agent ↔ Skill 多对多桥表，关键字段：`slotIndex` Int? (0..5) 标记装备到脊柱/大脑哪个槽；`unlocked` 锁/解锁标志。同一 agent 同一 slot 唯一性由 API 事务保证（`db push` 不支持 partial unique index）。每个 agent 的 equip 总数硬上限 = `SKILL_SLOT_COUNT`（=6），由 [POST /api/agents/[id]/skills](app/api/agents/[id]/skills/route.ts) 在事务里 count 校验，超出返回 409；slotIndex 允许为 null（[`SkillLibrary`](app/agent-control/components/SkillLibrary.tsx) 的快速 toggle 走这条路），但 null 行也计入上限。

**Prisma client** —— 通过 `lib/db.ts` 单例导出，避免开发热重载时连接泄漏。`postinstall` 自动 `prisma generate`。

## 路由速览

```
app/
  login/                — token 登录页
  admin/users/          — 管理员用户管理
  profile/              — 当前用户主页
  agent-control/      — Agent / Skill 装备界面（tab=agents 默认 / tab=skills 库 CRUD）
  api/
    auth/{login,logout,me}
    users/[id]          — GET / PATCH / DELETE（写需 admin）
    activities/[id]     — GET / DELETE
    profile/            — PATCH 更新 bio
    locale/             — POST 切换语言
    agents/             — GET / POST，[id] PATCH/DELETE，[id]/skills POST/[skillId] PATCH-DELETE，
                          [id]/{pipeline,dispatcher} PUT，[id]/deploy POST，
                          [id]/invoke POST（异步建 AgentJob），
                          [id]/dry-run POST（同步，不建 job，编辑器 Test Run 用），
                          [id]/jobs GET，[id]/jobs/[jobId] GET / [jobId]/retry POST
    skills/             — GET / POST，[id] PATCH / DELETE，[id]/test-invoke POST
```

## 环境变量

复制 `.env.example` → `.env`（已在 `.gitignore`，**禁止 commit**）。最小集合：

```bash
DATABASE_URL="postgresql://gd_dev:gd_dev_local@localhost:5432/green_diva?schema=public"
ADMIN_TOKEN="..."             # seed 初始 admin token
SAFETY_SECRET="..."     # ≥32 字节，openssl rand -base64 32（详细影响范围见下方运维约定段）；旧名 VAULT_COOKIE_SECRET 已废弃（2026-05-04 改名），本地 .env 若仍残留请改名，否则三处 cookie 签名静默失败
SECRET_DOOR_PASSWORD=""       # /vault 暗门 UI 输入的明文密码（与 SAFETY_SECRET 是两个独立 env，协作完成"密码 → 签 cookie"）
# ALLOW_PROD_SEED=1           # 生产环境强行运行 seed 才需要
# 以下两个仅在用 LLM_PROMPT skill / Orchestrator (AUTONOMOUS agent) 时需要：
# ANTHROPIC_API_KEY="sk-ant-..."  # 默认 LLM_PROMPT/Orchestrator provider; handlerConfig.authEnv 可改名
# OPENAI_API_KEY="sk-..."         # provider=openai 时读这个
```

## 本地数据库（Postgres + Homebrew）

本地与线上**统一用 Postgres**（不再用 SQLite），引擎一致避免迁移与并发行为偏差。数据隔离：本地连本地实例，**绝不**把 `.env` 指向生产 DB。

**首次安装**（Mac，需要 Homebrew）：

```bash
brew install postgresql@16
echo 'export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

brew services start postgresql@16   # 启动 + 开机自启
createuser -s gd_dev
psql postgres -c "ALTER USER gd_dev WITH PASSWORD 'gd_dev_local';"
createdb -O gd_dev green_diva

npm run db:push                      # 同步 schema
npm run db:seed                      # 写入示例数据
```

**日常**：

```bash
brew services start postgresql@16    # 启
brew services stop postgresql@16     # 停（数据保留在 /opt/homebrew/var/postgresql@16）
brew services restart postgresql@16  # 重启
psql -U gd_dev -d green_diva         # 直连查表
```

**重置 dev 数据**：

```bash
dropdb green_diva && createdb -O gd_dev green_diva && npm run db:push && npm run db:seed
```

## 生产数据库运维约定

- **本地与生产凭据 / 数据严格隔离**：**绝不**把生产 `DATABASE_URL`、`token`、用户密码或任何 secret 复制到本地 `.env`。统一用 Postgres **只为引擎一致**，不是凭据可共享。本地需要测试某种用户角色，自己用 [.env](.env) 的 `ADMIN_TOKEN` 登 High Lord，或 `psql` 直接 insert 一个本地测试用户（token 用 `openssl rand -hex 16` 生成）。需要复盘生产 bug 时走 `pg_dump` → 脱敏（`UPDATE "User" SET token = encode(gen_random_bytes(24), 'hex'), avatarUrl = NULL, bio = NULL`）→ 导入本地，绝不直连。原因：dev 模式日志会打印 query 参数（token 明文进 scrollback），`.env` 有非零概率被误 commit，IDE / AI 工具可能把文件内容上传到云端。
- **最小权限账户**：应用连接的 DB user 仅 `CONNECT / SELECT / INSERT / UPDATE / DELETE / USAGE`，**禁止** `DROP / TRUNCATE / CREATE`。Schema 变更走单独的 owner 账户 + `prisma migrate deploy`，不要让 app user 持有这些权限。
- **每日 dump 备份**：`pg_dump --format=custom` 每日一次，保留至少 7 天，dump 文件加密存储（KMS / SSE-S3）。恢复演练每季度一次。
- **`.env` 永不进仓**：`.gitignore` 已覆盖 `.env*`。线上 secrets 走平台环境变量或 secret manager，不进 git。
- **`SAFETY_SECRET`** 是 server-side 安全 root，**3 处直接读取**：① [`lib/userToken.ts`](lib/userToken.ts) HMAC 派生 `tokenLookup`（O(1) 登录查表）；② [`lib/vault-token.ts`](lib/vault-token.ts) + [`middleware.ts`](middleware.ts) 签 / 验 `gd_vault` cookie（暗门会话）；③ [`lib/relicCookie.ts`](lib/relicCookie.ts) 签 `gd_relic_unlocks` cookie。**生产必填且 ≥32 字节**（`openssl rand -base64 32`）。轮换它会让以上**全部**失效（用户重登录 / 重 unseal vault），但**用户的 vault master password 与此完全无关**——`VaultItem` 是客户端 E2E 加密，server 没有解密能力。
- **未来加密码**：当前 `User.token` 是 random bytes 不可逆，安全。如未来引入密码字段，**必须** bcrypt（cost ≥12）或 argon2id 哈希后入库，**绝不存明文或可逆加密**。
- **`prisma db seed` 在生产被拒绝**：[prisma/seed.ts](prisma/seed.ts) 已加 `NODE_ENV === "production"` 守卫，需要 `ALLOW_PROD_SEED=1` 才能强行跑。仅在初始化新环境时使用。

## Relic 上传流水线（极简版）

跨 `lib/relics/pipeline/`、`/api/relics/draft|job|jobs/[jobId]/retry`、`app/relic-collection/` 的子系统。当前 pipeline **只有 2 个 step**：`EXTRACT_ZIP`（解压上传 ZIP）→ `PACK_DERIVED`（把解压产物 + 原 ZIP + metadata 打包成 derived ZIP）。

要点：
- **Fire-and-forget**：`/api/relics/draft` 创建 Job 后 `void runRelicPipeline(jobId)` 立即返回 201，**绝不 await**。
- **顶层永不 throw**：`runRelicPipeline` 顶层 `try/catch` 把任何错误写到 `Job.errorMessage` + `status=FAILED`。
- **自动重试**：runner 对瞬时错误（5xx / timeout / ECONN / EAI_AGAIN / "fetch failed"）退避（`2^attempt * 1s`）至 `Job.maxAttempts=3`。
- **续跑**：`POST /api/relics/[id]/jobs/[jobId]/retry?fromStep=PACK_DERIVED` 从指定 step 续跑；上游 step 结果从 `Job.stepResults` JSON 还原。
- **Crash recovery**：[`lib/server-init.ts::ensureServerInit()`](lib/server-init.ts) 在 `/api/relics/draft` + `/api/relics/[id]/job` 入口懒触发，重启 `RUNNING & updatedAt < 10min ago` 的 job。**新加 job-creating endpoint 时也要调** `await ensureServerInit()`。
- **文件布局**：`private/relics/{slug}/{source/{archive-{ts}.zip, extracted/}, derived/}`；`Relic.derivedArchivePath` 是最终归档 ZIP（详情页"下载归档资料包"按钮自动 enabled）。
- **进度 UI** = **3 秒 setInterval 轮询**（参考 [`RelicProcessingBanner.tsx`](app/relic-collection/[slug]/_components/RelicProcessingBanner.tsx)），完成后 `router.refresh()`。
- **简化的新建路径**：[`RelicDraftPanel`](app/relic-collection/_components/RelicDraftPanel.tsx) 上传 ZIP + 描述 → 自动跳详情页 → banner 展示进度。旧 [`RelicForm`](app/admin/relics/RelicForm.tsx) 仅作"编修"。
- VaultCell 在 `relic.status === "PROCESSING" / "DRAFT"` 时显示右下 `progress_activity` 旋转图标。

> 历史版本曾有 `REMOVE_BG / STRUCTURED_FIELDS / GEN_3D / WEB_RESEARCH / WRITE_LORE` 5 步 AI 处理 + capability 子系统（lib/clerics/ + ClericSecret 表 + admin 配置 UI），已于 2026-05-05 整体移除。当前 pipeline 不调任何外部 AI 服务。

## Agent Control 装备界面（`/agent-control`）

赛博朋克 2077 风格的装备面板，承载站内所有 AI workflow（mode = `MECHANICAL`，黄色）和 AI agent（mode = `AUTONOMOUS`，青绿）。"ai-clergy" 是已废弃的旧名，**不要再创建 `/ai-clergy` 路由**——所有迭代统一在 `/agent-control` 下。

**命名层级（务必区分，三者重叠很容易混）**：
- **路由段**：`/agent-control`（固定字面量，不要拆）。
- **Mode 枚举**：`MECHANICAL` / `AUTONOMOUS`（DB enum，见 [prisma/schema.prisma](prisma/schema.prisma)）。下文若简写为 "machine 模式" / "agent 模式"，仅作叙述代称，**不要用作 DB / API 字段值**。
- **Tab key**：`agents` / `skills`（[`AgentClient.tsx`](app/agent-control/AgentClient.tsx) `TabKey`），`agents` 下显示 roster 与详情，`skills` 下做 SkillLibrary CRUD。这里的 "agents" 指 tab 名，**不是** mode 名。

**单屏布局** —— ≥1024px 桌面端 100vh **不出现外部滚动条**，左 `lg:col-span-3` roster + 右 `lg:col-span-9` 详情区。详情区 5 块垂直堆叠：DetailHeader → BaseStatsBar（4 条 0% 进度条）→ EquipmentLoadout（核心，`flex-1 min-h-0`）→ ControlConfigStrip → DeployButton。布局骨架在 [`AgentClient.tsx`](app/agent-control/AgentClient.tsx)。

**槽位** —— 每个 Agent 6 个 skill 槽 + 1 个中央 CONTROL 槽，绝对定位 + 百分比坐标，常量集中在 [`lib/agentControl/slotPositions.ts`](lib/agentControl/slotPositions.ts)：
- machine（脊柱）—— 3×2 网格左右对称（top 18% / 50% / 82%，left 18% / 82%）；背景 `/public/images/agent-control/spine.jpg`，缺图自动 fallback `spine.svg`。
- agent（大脑）—— 圆弧排列 6 点；背景 `/public/images/agent-control/brain.jpg`，缺图 fallback `brain.svg`。
- **资产路径必须在 `/public/images/` 下**——`/agent-control/*` 跟同名 page route 冲突，被 middleware 鉴权拦截，Next.js Image 优化器拿不到（详见"资源与性能"段的"静态图与 middleware 鉴权"）。
- 未来要基于上传图切割自动调对齐时只改这一个文件，签名预留 `getLoadoutLayout(mode)`。

**Agent 命名结构（4 字段双语对）** —— 编辑表单上呈现两组：
- **Name 对**：`codename`（slug，uppercase / digits / dash，如 `DIVA-001`）+ `codenameZh`（中文身份名，可空）—— 唯一标识。
- **Role 对**：`nameEn` + `nameZh` —— 角色 / 职能描述（如 `Neural Operator` / `神经网络接线员`）。
- 历史上 `nameEn / nameZh` 曾被标 "Role"，但 DB 字段名保留 `name*`。新增显示 / 检索逻辑别误把 `nameEn` 当作技术 ID。

**⚠️ 中央槽不是 skill** —— 它存的是"如何调度 6 个 skill 协作运行"的配置：
- machine 中央 = **Backbone**，对应 `Agent.pipelineConfig` Json（workflow 节点 / 连线 / 参数）
- agent 中央 = **Orchestrator**，对应 `Agent.dispatcherConfig` Json（AI 调度策略 / 模型 / prompt）

数据上是 Json 字段，**不是 skillId 外键**。UI 上中央槽点击弹 [`ControlConfigModal`](app/agent-control/components/ControlConfigModal.tsx)（JSON textarea 占位 + 标"待开发"），不是 SkillPicker。SkillLibrary CRUD（`tab=skills`）只管 skill 自身能力定义，与中央槽互不重叠。改这块务必保持边界。

**Skill 是 mode-agnostic 的统一资产** —— 一条 Skill = 一个"带类型签名的可调用单元"，**不属于** MECHANICAL 或 AUTONOMOUS 任何一边，两类 agent 共用同一张 Skill 表 + 同一个 SkillLibrary（已验证：[`prisma/schema.prisma`](prisma/schema.prisma) `model Skill` 无 mode 字段，[`AgentSkillEquip`](prisma/schema.prisma) 桥表无 mode 校验，[`/api/skills`](app/api/skills/route.ts) 不按 mode 过滤）。**绝不**在 Skill 表加 mode 字段或建"MECHANICAL-only / AUTONOMOUS-only"的子集——这违反统一资产的设计意图。

mode 差异**只活在 Agent 层**，决定"如何串联 skills"：
- MECHANICAL → `pipelineConfig` 描述线性 / DAG workflow，Backbone 按图调度，skill 作为节点
- AUTONOMOUS → `dispatcherConfig` 描述 LLM 调度策略，Orchestrator 把 skills 作为 tools 喂给模型，由模型决定何时调

未来 Skill runtime 落地时，需要补的字段是**两类 runtime 共用**的（`inputSchema` / `outputSchema` JSON Schema、`handlerKind` + `handlerConfig`），不是分两套。LLM tool calling 本身就吃 JSON Schema，与 workflow 节点的 IO 契约同源。

**UI 用语统一**——面向用户的所有可见文本：MECHANICAL 模式统称 **Backbone**（"Backbone Config" 卡片 / footer "Backbone : Success/Pending"），AUTONOMOUS 模式统称 **Orchestrator**。**不要**在 UI 上回退到老的 "CONTROL" 措辞；i18n 字典里 `controlConfigTitle` 等老 key 已被组件内 `isMech ? "Backbone..." : "Orchestrator..."` 硬编码覆盖。新加文案 / 模态保持这一边界。（本文档为简洁，叙述层仍用"中央槽"指代该位置——这是文档内部代称，与 UI 文案规则无关。）

**Skill.status 字段（ONLINE / OFFLINE，当前默认 ONLINE）** —— [`prisma/schema.prisma`](prisma/schema.prisma) `model Skill` 新增字段，单条 skill 的可用性。三处 UI 直接消费：

> ⚠️ **未来必改 / 已知冲突点**：当前 status 是"静态默认 ONLINE + 人工 toggle"的占位实现，新建 skill 装上即彩色发光。**未来语义应改为：基于 skill 真实可用性自动判定**（依赖资源是否就绪、外部 API 健康检查、最近 N 次调用成功率等），人工不再直接 set。届时：① 默认值会变（很可能初始 OFFLINE，等首次健康检查通过才转 ONLINE）；② 写入路径不再是 PATCH `/api/skills/[id]`，而是后台健康检查服务；③ 现在依赖"装上立刻发光"的 UI 体感会变。新加任何依赖 status 的逻辑前请先确认是否会被这次重构推翻。

- [`SkillConnections.tsx`](app/agent-control/components/SkillConnections.tsx) 装备线颜色：empty → 灰、equipped+OFFLINE → 灰、equipped+ONLINE → mode 主色（金 / 青绿）。
- [`SkillDetailCard.tsx`](app/agent-control/components/SkillDetailCard.tsx) 右栏每行徽章直接显示 `ONLINE` / `OFFLINE`（绿 / 灰），**已替换** PASSIVE/ACTIVE/ULTIMATE 的 kind 徽章。
- [`DetailHeader.tsx`](app/agent-control/components/DetailHeader.tsx) MECHANICAL / AUTONOMOUS 徽章：所有装备 skill 中无 ONLINE 时灰底，否则 mode 主色。

页面 server data 通过 [`app/agent-control/page.tsx`](app/agent-control/page.tsx) 序列化（`skills` 与 `equipsByAgentId.skill` 都要带 `status`）。新加任何展示 skill 的 UI 别忘了透传这个字段。

**SkillConnections 装备线（PCB trace）** —— [`SkillConnections.tsx`](app/agent-control/components/SkillConnections.tsx) 在装备背景图上叠 SVG，渲染 6 个 skill 槽到中央槽 + 同列槽位之间的连线（左右两根纵向 trunk + 6 条 elbow / 横线）。坐标从 `slotPositions.ts` 的百分比派生，viewBox 0 0 100，`preserveAspectRatio="none"` 拉伸。每条 trace 双层 stroke：暗色 halo 在下做对比 + mode 色 stroke 在上发光。**重要**：`<filter>` 必须用 `filterUnits="userSpaceOnUse"` + 绝对坐标，**不要**用默认 `objectBoundingBox`——纯水平 / 纯垂直线 bbox 高 / 宽为 0，filter 区域塌陷成空，彩色 stroke 整段不渲染（只剩 halo 看着像灰）。这条规则适用于以后任何用 SVG `<filter>` 处理 axis-aligned 线 / 单点的场景。

**派生 stats 占位** —— `chaosLevel / costTier / activityLevel / stabilityLevel` 当前都返回 0%，UI 显示"⏳ pending derivation"。未来算法落在 `lib/agents/derived.ts`（TODO），输入是 AgentSkillEquip + 调用历史。语义：
- chaos = 跨 mode 装配的"赛博精神病"指数（如 machine 装满 agent 类 skill）
- cost = 外部 API 累计花费等级
- activity = 滑窗内调用次数
- stability = 调用成功率

**调用层（Phase 1-4 已落地，2026-05-07）** —— 详见 [docs/skill-handler-system.md](docs/skill-handler-system.md) + 下方"Skill Handler 与运行时"段。三层调用栈：[`lib/agents/invoke.ts`](lib/agents/invoke.ts) 按 `agent.mode` 分发到 [`lib/skills/runtime/backbone.ts`](lib/skills/runtime/backbone.ts)（MECHANICAL，线性 pipeline）或 [`lib/skills/runtime/orchestrator.ts`](lib/skills/runtime/orchestrator.ts)（AUTONOMOUS，LLM tool-use loop，Anthropic + OpenAI）。Deploy 按钮**仍只更新 `deployedAt`**，不真正注册——真实调用走 `POST /api/agents/[id]/invoke`（异步，建 AgentJob）或 `POST /api/agents/[id]/dry-run`（同步，编辑器用）。

**主色绑定 mode** —— machine = `secondary` (#e9c176 金黄)，agent = `primary` (#90decd 青绿)。新 UI 子组件接 `agent.mode` 切两套配色，不要硬编码颜色。**Tailwind 不能动态拼类名**——必须 `isMech ? "text-secondary border-secondary/40 ..." : "text-primary border-primary/40 ..."` 整段硬编码两套，写 `text-${accent}` 会被 PostCSS 干掉。

**新建 agent 默认 mode = AUTONOMOUS**（[AgentEditor.tsx](app/agent-control/components/AgentEditor.tsx) `blankFromInitial`），因此首屏中央槽 = **Orchestrator**（消费 `dispatcherConfig`），背景图走大脑、主色青绿。注意 Prisma schema 里 `Agent.mode` 列默认是 `MECHANICAL`——这是 DB 兜底，**不**是新建 UI 的入口默认。未来若引入"模板创建"等流程，保持 UI 默认 AUTONOMOUS。

**Runtime config 已整体下架** —— `Agent` 表的 `enabled / provider / model / systemPrompt / internalHandler / inputSchemaJson / outputSchemaJson / maxTokens / temperature / rateLimitPerMin` + `AgentProvider` enum 已于 2026-05-07 删除（[`prisma/migrate-remove-runtime-config.ts`](prisma/migrate-remove-runtime-config.ts)）。**未来 runtime 配置统一走中央 CONTROL 槽**：machine 进 `pipelineConfig`，agent 进 `dispatcherConfig`，不要再往 Agent 表加扁平的运行时字段。

**Agent 派生 stats（chaos/cost/activity/stability）+ syncLevel/matrixLevel/availableAp 不再人工编辑** —— Editor 已不暴露，DB 字段保留给未来 auto-calc 服务（`lib/agents/derived.ts` TODO）。新需求别在编辑表单里加这几个字段的 input。

**Agent portrait 上传** —— 走 [`/api/agents/avatar/upload`](app/api/agents/avatar/upload/route.ts) multipart endpoint，admin-only。前端选文件 → [`AvatarCropModal`](app/agent-control/components/AvatarCropModal.tsx)（`react-easy-crop` 依赖）按 **131:304 ≈ 0.4309** 比例裁切（与 hero portrait 外框一致）→ canvas 转 JPEG Blob → 上传。endpoint 不校验 mime/ext/size（已裁切过），只验 admin auth。返回相对路径 `/images/agent-control/avatars/<ts>-<rand>.<ext>`。

**`avatarUrl` validator 接受两种格式** —— `http(s)://...` **或** `/`-开头的绝对路径（[`lib/validators.ts`](lib/validators.ts)）。本地上传走后者，远程 URL 走前者。**别**回退成 `z.string().url()`——会拒绝所有上传后的路径。

## Skill Handler 与运行时（Phase 1-4 落地，2026-05-07）

完整设计：[docs/skill-handler-system.md](docs/skill-handler-system.md)。本节仅列**改动会破坏全链路的硬规约**。

**三层调用栈**：编排器（agent 层）→ skill（资产层）→ handler（调用层）。**不可跨层硬连**——加新具体能力走 DB 配置（UI 操作），加新 handler 类型 / 编排器类型走 git PR。

**绝对不要做的事**：
1. **永远不要做 ZIP 上传插件**。Skill = "数据 + 配置"（DB 一行），不是"上传可执行代码"。这条决定刻进设计——破它就是 RCE / 沙箱 / 依赖管理 / 版本撤销 等大坑。复杂 AI agent 走 MCP 协议或独立服务（远程 endpoint），不要塞进主站进程。
2. **`handlerConfig` 永远不能含明文 secret**。[`lib/validators.ts`](lib/validators.ts) `PLAINTEXT_SECRET_RE` 已用正则拒绝 `apiKey/secret/token/password/bearer/access_key` 等键名。Secret 走 env，`handlerConfig.authEnv` 只存 env 名。改 validator 时保住这条 refine。
3. **`AgentRunResult` 是 discriminated union（success | failure），不要回退成 throw**。[`lib/skills/runtime/runner.ts`](lib/skills/runtime/runner.ts) 依赖此契约：失败时 `runLog` 仍能写进 DB，让 `AgentJobDrawer` 显示"step N 哪一步炸了"。改 invoke 签名要联动 runner + backbone + orchestrator 三处。
4. **`PUT /api/agents/[id]/{pipeline,dispatcher}` schema 是严的**（[`pipelineConfigSchema`](lib/validators.ts) / [`dispatcherConfigSchema`](lib/validators.ts)）—— `BackboneEditor` / `OrchestratorEditor` 是它们唯一的写入者。手工 curl raw JSON 会被拒。

**代码组织**：
- `lib/skills/handlers/` 4 个 handlerKind 实现：`httpApi.ts` / `llmPrompt.ts`（Anthropic + OpenAI 双 provider，env 默认按 provider 切）/ `mcpServer.ts`（Phase 5 占位）/ `internal/index.ts`（slug 映射，注册新 internal handler 必须 commit）
- `lib/skills/registry.ts` —— HandlerKind → handler 函数映射
- `lib/skills/invoke.ts` —— 单次调用入口（input/output JSON Schema 校验）
- `lib/skills/runtime/{backbone,orchestrator,runner}.ts` —— 编排器 + async runner
- `lib/agents/invoke.ts` —— mode 分发器，dry-run 用 `pipelineConfigOverride` / `dispatcherConfigOverride` 形参注入未保存的 config

**dispatcherConfig shape**（AUTONOMOUS）：`{ version: 1, provider: "anthropic"|"openai", model, systemPrompt?, maxIterations?, temperature?, authEnv? }`。
**pipelineConfig shape**（MECHANICAL）：`{ version: 1, steps: [{ id, equipSlot 0-5, inputMapping: { from: "agent.input"|"<stepId>.output" } }] }`。`equipSlot` 而非 `skillId`——换装时 pipeline 不会 dangling。

**SkillEditor / BackboneEditor / OrchestratorEditor 都有 Test Run/Test Invoke 按钮**，分别打 `POST /api/skills/[id]/test-invoke` 或 `POST /api/agents/[id]/dry-run`（接受 config override，同步执行不建 AgentJob）。Production 调用走 `POST /api/agents/[id]/invoke`（异步建 job）。改前者 / 后者契约时要联动编辑器。

**`Skill.status` 当前是人工 toggle**（OFFLINE 时 backbone 报 SKILL_OFFLINE，orchestrator 不暴露为 tool）。Phase 5 会改成 healthcheck-driven 自动判定——别在新 UI 里依赖"装上立刻发光"的体感。

## Prisma db push 与生产迁移范式

仓库**不用 `prisma migrate`**（无 `prisma/migrations/` 目录），所有 schema 同步走 `prisma db push`。`npm start` 串联多步（每个 migrate 脚本都是幂等的）：

```
tsx prisma/migrate-token-hash.ts \
  && tsx prisma/migrate-agent-loadout.ts \
  && tsx prisma/migrate-remove-runtime-config.ts \
  && tsx prisma/migrate-remove-classification.ts \
  && tsx prisma/migrate-skill-handlers.ts \
  && prisma db push --skip-generate --accept-data-loss \
  && next start
```

**遇到"data loss"拒绝时不要直接加 `--accept-data-loss` 了事** —— `db push` 不带这个 flag 拒绝执行的两类操作（删列、把可空列改 NOT NULL 但仍有 NULL 行），都应该先在一个一次性 `prisma/migrate-*.ts` 脚本里手工处理，让 db push 真正变成无害 diff。范本三个：
- [`prisma/migrate-token-hash.ts`](prisma/migrate-token-hash.ts) —— bcrypt 重哈希 + 删老 `User.token` 列
- [`prisma/migrate-agent-loadout.ts`](prisma/migrate-agent-loadout.ts) —— drop 6 老 stat 列 + backfill 空 `Agent.avatarUrl`
- [`prisma/migrate-remove-runtime-config.ts`](prisma/migrate-remove-runtime-config.ts) —— drop 10 个 Agent runtime 列 + drop `AgentProvider` enum + add `Agent.codenameZh`

模式：用 `information_schema` 检查列存在 → 存在则 `ALTER TABLE ... DROP COLUMN IF EXISTS` 或 `UPDATE ... SET ... WHERE ... IS NULL`。**幂等**——重跑无副作用。新加破坏性 schema 改动时复制一个新 migrate 脚本接到 npm start 链上。`--accept-data-loss` 只作兜底，不作主路径。

## 设计约定（已踩坑结论）

### 排版与响应式
- **`html` 根字号 = 13px**（不是 16px）。所有 Tailwind `rem` 工具类按这个基准计算 → `w-11` ≈ 35.75px、`w-12` = 39px。**触屏目标 ≥44px 必须用 `w-[44px] h-[44px]`**，不要依赖 `w-11`。
- **桌面 nav 用 `lg:` 断点**（≥1024）。`md:` (768) 不足以舒适放下当前 4 项 nav + `gap-11`，768~1023 走 `MobileNav`。新增 nav 项时重新评估。
- **页面外壳**：`app/page.tsx` 顶层 `<div>` 用 `flex flex-col flex-1`（**不要** `min-h-screen`，body 已经是）；否则 `SiteFooter` 会被挤出视口产生 30px 滚动。
- **`<main>` 加 `md:min-h-0 md:overflow-hidden`**：阻止文字 / 图片 intrinsic 高度把 main 顶大。否则在 800px 视口会有 ~25px 溢出。
- **`min-h-[*]` 反压陷阱**：`HeroPortrait` 之前的 `lg:min-h-[360px]` 等硬地板会撑大父容器，破坏 viewport-locked 布局。需要随容器收缩的元素用 `lg:min-h-0`。
- **等高布局**：用 `grid grid-rows-N gap-X` + 子项 `min-h-0`。**避免** `flex-1` + 不一致的 `min-h-[X]`（min-content 会抢占造成不等分）。已落地的范本是首页右栏（4 模块 + 左栏 hero+视频）。
- **移动端字号下限 12px**：`globals.css` 已有 `@media (max-width: 639px)` 规则把 `.font-label.text-\[8/9/10/11px\]` 强制 12px + `letter-spacing: 0.2em`。新加 `font-label` 小字号自动受益，**不要**单独加 `sm:` 前缀重复处理。
- **Tailwind v4 选择器陷阱**：`[class*="text-[Xpx]"]` 在 lightningcss 下不稳；要用 `.font-label.text-\[Xpx\]` 转义类选择器 + `!important` 才能覆盖 Tailwind 生成的 utility。
- **中文行高更高**：`html[lang="zh"]` 全局设 `--tw-leading: 1.8`、`p/li` 显式 `line-height: 1.8`（[globals.css:78-86](app/globals.css:78)）。算像素布局时记得中文段落比同样行数英文高 ~10-15%，等高布局两语言下要分别测。
- **Touch 设备悬停**：自定义变体 `touch:`（= `@media (hover: none)`）。给桌面 `hover:` 加效果时一并加 `touch:` 复刻一份，否则手机上看不到态变化（参考 [page.tsx](app/page.tsx) 模块卡片 `group-hover:bg-primary/20 touch:bg-primary/20`）。
- **图标统一用 Material Symbols**：`<span className="material-symbols-outlined">menu_book</span>`，不要引入 SVG icon 库。fill / weight 通过 `style={{ fontVariationSettings: "'FILL' 1" }}` 调整。

### API 与安全
- **错误脱敏**：catch 块写 `console.error("[scope] ...", e)`，给客户端只回通用文案 `"create failed"` / `"update failed"`。**不要**回传 `e.message`（会泄露 Prisma "Unique constraint failed on token" 之类 schema 信息）。
- **速率限制 canonical**：`app/api/vault/unseal/route.ts` 是范本（IP-keyed Map / `MAX_ATTEMPTS=5` / `WINDOW_MS=60_000` / `FAIL_DELAY_MS=600`）。新写敏感写端点（登录、解锁、付费）抄它。**注意**：内存 Map 仅适合单实例 / 低 QPS；多实例部署必须换 Redis 或外部限流。
- **CSRF**：middleware 已统一处理 `/api/*` 的写方法。从外部脚本调写 API 必须带 valid `Origin`，否则 403。同源浏览器请求自动通过。
- **Token 掩码统一格式**：用户 token 在 API 返回前必须 mask 为 `${token.slice(0,4)}…${token.slice(-4)}`（≤8 字符用 `"••••"`）。完整 token **仅在创建用户那次响应**返回一次，之后再也不回传明文。范本 [app/api/users/route.ts](app/api/users/route.ts) `maskToken()`、[app/profile/TokenField.tsx](app/profile/TokenField.tsx)。
- **级联删除无审计**：`User` 删除会经 `onDelete: Cascade` 同步清掉 `Session`、`Activity`、`Bio`，**没有日志**。所以前端删除前用 `confirm()`（[UsersTable.tsx](app/admin/users/UsersTable.tsx)）；后端如需追溯请先加 audit table 再开放接口。

### Server / Client 边界
- **不能从 Server Component 传函数到 Client Component**（"Functions cannot be passed directly..."）。排序、表头链接等场景用预计算的字符串/对象（如 `sortHrefs: Record<Field, string>`），不要传 `(field) => string`。
- i18n 严格分边界（已在架构要点段说过）。新增字典 key 必须**同时**改 `lib/i18n/types.ts` + `en.ts` + `zh.ts`，否则 `tsc` 报错。
- **`"use client"` 用最小子集**：仅在确实需要 hook / state / event 的组件加。`SiteFooter` / `PlaceholderPage` 等纯展示用 `async` server component。Server Component 可以包裹 Client Component 子树，反过来不行。

### 容器组件（Tailwind 高度链）
- **`CyberPanel` 内部包了一层 `<div className="relative z-10 h-full">`** —— 这意味着直接给 `CyberPanel` 加 `flex flex-col min-h-0` className **对子节点无效**（children 的真实父是那层 block div 不是 flex）。新建 5 块垂直布局时务必在 children 外再包一层 `<div className="flex flex-col h-full gap-3 min-h-0">`，否则 `flex-1` / `shrink-0` 全部失效，子区域会被挤成 0 高度。范本 [`AgentClient.tsx`](app/agent-control/AgentClient.tsx) 详情区。
- **背景图绝对定位 + 槽位百分比坐标**：用 `relative aspect-[3/4]` + `next/image fill object-contain` + 子节点 `absolute -translate-x-1/2 -translate-y-1/2` + 顶层 `top/left` 百分比常量。背景图缺失时给 `<Image onError>` 切到同名 SVG fallback（避免 layout 因 404 崩塌）。范本 [`EquipmentLoadout.tsx`](app/agent-control/components/EquipmentLoadout.tsx)。

### Prisma 写入陷阱
- **可空 Json 字段写 `null` 必须用 `Prisma.JsonNull`** —— `data: { pipelineConfig: null }` 类型报错。正确写法：`pipelineConfig: parsed.config === null ? Prisma.JsonNull : (parsed.config as Prisma.InputJsonValue)`。范本 [`app/api/agents/[id]/pipeline/route.ts`](app/api/agents/[id]/pipeline/route.ts)。
- **Partial unique index 不能写在 schema** —— Prisma `@@unique([a, b])` 不支持 `WHERE` 过滤。`AgentSkillEquip` 的"同 agent 同 slotIndex 唯一"靠 API 事务里 `deleteMany({ where: { agentId, slotIndex } })` 先清后插实现，schema 里只放普通 `@@index`。

### 开发缓存（绝对避免）
- **dev 服务器跑着的时候不要跑 `npm run build`** —— production build 写 `.next/` 会覆盖 dev 引用的 chunk 文件，dev 立即报 `Cannot find module '../chunks/ssr/[turbopack]_runtime.js'` 然后整页白屏。恢复需要 `preview_stop` → `rm -rf .next .next-dev` → 重启 dev 进程。验证用 `type-check` + `lint` 即可，build 等所有改动 stable 后单独跑。
- **`rm -rf .next` 时不要让 dev 还在跑** —— 同样会让 turbopack 进入 build-manifest 找不到的循环报错（`Persisting failed: Another write batch or compaction is already active` / `ENOENT build-manifest.json`）。恢复路径同上：先 `preview_stop` → `rm -rf .next .next-dev` → `preview_start`。频繁热更改大量文件偶尔也触发，遇到先重启再查代码。
- **Next.js Image 内存缓存** —— 优化器对图片有 in-memory 缓存（按文件 mtime 索引）。改了 `public/` 下的资源后页面如果还是显示旧图，浏览器硬刷不一定够；需要 `rm -rf .next/cache/images` 或重启 dev。生产环境靠 mtime 自动失效。
- **schema 加 / 删字段后必须重启 dev 进程** —— `npm run db:push` 跑完会重新生成 `@prisma/client`，但已运行的 Next dev 进程把老的 client module 缓存在内存里（HMR 不会换 `node_modules`）。直接刷新页面会走老的字段映射，新列读到 `undefined`，UI 静默走 fallback 分支（如 `status === "ONLINE"` 永远 false → 全部 OFFLINE 渲染）。看到"DB 里值是对的、UI 却像没读到"先怀疑这条；恢复：`preview_stop` → `preview_start`（fresh process），然后 reload 验证。

### 组件交互模式
- **写后必跑 `router.refresh()`**：POST/PATCH/DELETE 完成后客户端调 `router.refresh()` 重拉服务端数据，App Router 不会自动失效。落地范本：[LanguageSwitcher](components/LanguageSwitcher.tsx)、[BioEditor](app/profile/BioEditor.tsx)、[ActivityList](app/profile/ActivityList.tsx)、[UsersTable](app/admin/users/UsersTable.tsx)。
- **下拉菜单**：`useRef + onMouseDown 监听 document + ESC 键`（参考 [UserMenu.tsx](components/UserMenu.tsx)）。新做 dropdown 沿用，不要自己造。
- **主题化 select 替代原生 `<select>`**：原生 `<select>` 展开后是 OS 渲染的菜单，**完全无法 CSS 控制**（蓝白底）。需要跟主题色一致的下拉用 [`AgentEditor.tsx`](app/agent-control/components/AgentEditor.tsx) 内的 `ThemedDropdown` 模式：button trigger + `absolute z-50` panel + `aria-haspopup="listbox" / role="option"`。沿用同一模式，不要再硬塞 `<select>` 然后试图调样式。
- **图像裁切上传**：用 `react-easy-crop` + canvas 切片 + 自家 upload endpoint。范本 [`AvatarCropModal.tsx`](app/agent-control/components/AvatarCropModal.tsx) —— 锁 aspect、zoom 滑杆、Apply 时 `canvas.toBlob` 转 JPEG 上传。新加任何"上传图片到固定显示比例"的流程沿用，不要让用户自己切。
- **全屏抽屉/模态**：`createPortal(...,  document.body)` + `body.style.overflow = "hidden"` + ESC 关闭（参考 [MobileNav.tsx](components/MobileNav.tsx)）。新模态沿用 portal 模式避免 z-index 战争。
- **不可逆操作确认**：用浏览器原生 `confirm()` + `format(t.x.confirm, { name })` 模板（参考 [UsersTable.tsx](app/admin/users/UsersTable.tsx) 删除流程），不要自己造确认弹窗。
- **倒计时 / 时间相关组件**：渲染含 `Date.now()` 的内容必须套 `suppressHydrationWarning`（服务端渲染时间戳和客户端初次渲染必然不一致）。参考 [DescentCountdown.tsx](components/DescentCountdown.tsx)。

### i18n 调试 & 模板语法
- `getDictionary()` 无缓存，HMR 即时生效。文字"没改掉"99% 是浏览器强缓存 / 改错语言文件 / 文本含 `##...##` `**...**` `__...__` 被 hero 解析为高亮（[app/page.tsx](app/page.tsx) `originBody` 渲染逻辑），不是 SSR 锁。
- **模板占位符**：`format(template, vars)` 用 **双大括号** `{{name}}`，见 [lib/i18n/format.ts](lib/i18n/format.ts)。新模板字符串遵循。
- **Hero 文本专属 markup**（**仅 `originBody` 解析**）：`##...##` → 大号 `text-secondary` + `sacred-glow`；`**...**` → 中等强调 `text-secondary`；`__...__` → 强调 + glow。其他页面文字不会被解析，照搬 markup 不会变样式。

### 资源与性能
- **远程头像**：`avatarUrl` 是任意外部 host，**未在 `next.config.ts` 配置 `images.remotePatterns` 前不要换 `next/image`**（会运行时崩）。需要懒加载用 `<img loading="lazy" decoding="async">`。
- **静态图与 middleware 鉴权（重要陷阱）** —— middleware 默认对所有路由要求登录，仅 `STATIC_PREFIXES = ["/_next", "/fonts", "/images", "/videos"]` 直通。**Next.js Image 优化器在 SSR 阶段以 server-fetch 拿源图，不带 cookie**，命中鉴权路径会被 307 → `/login`，然后报 `"isn't a valid image"` 渲染 fallback。**所有 `next/image` 要消费的静态资产必须放 `/public/images/...` 下**（路径 = `/images/...`）。把图放进 `/public/<routeName>/`（如 `/public/agent-control/spine.jpg`）会撞 page route 鉴权。范本：所有 agent-control 资产存放于 `/public/images/agent-control/`。新增模块创建 `public/<...>` 目录前先想这条。
- **`next/image` quality 白名单** —— Next 16 要求 `images.qualities` 显式列出可用 quality。当前 [`next.config.ts`](next.config.ts) 配 `[75, 95]`，需要更高质量传 `quality={95}` 的 `<Image>` 才能生效；用未列入的值会回退到默认 75。新需求要加 q 值时同步改这个数组。
- **视频组件**：`SeamlessLoopVideo` 自动检测 `navigator.connection.saveData` / `effectiveType in {slow-2g, 2g, 3g}` / `prefers-reduced-motion`，命中即退化为静态 `<div>`（背景图 / 纯色）。新做循环视频组件沿用此模式，不要直接用 `<video autoPlay>`。HMR 中间态偶尔短暂走错分支，验证时硬刷新。

### 隐藏功能（产品意图）
- HeroPortrait 暗藏 SecretDoor：桌面 **10 次连点** 或移动端 **长按 10 秒** 解锁通向 `/vault`。**禁止**在 UI 加任何提示文字、图标或动画暗示。改 [HeroPortrait.tsx](components/HeroPortrait.tsx) / [SecretDoor.tsx](components/SecretDoor.tsx) 时保留低调。

## Commit 规范

`feat(personal-web): ...` / `fix(personal-web): ...`（遵循顶层工作簿约定）。

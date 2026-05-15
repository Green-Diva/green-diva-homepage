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

1. `middleware.ts`：全局闸门，自身分三步——① 公开白名单 exact match：`/login`、`/api/auth/login`、`/api/locale`、`/sacred-terms`、`/privacy-covenant`、`/favicon.ico`（**产品设计：会员制社区，登录页 + 条款 + 隐私之外全部需登录**；`PUBLIC_PREFIXES` 保持空数组，新增公开路由用 exact match 加入 `PUBLIC_PATHS` 并与用户确认）；② 校验 `gd_session` cookie 存在；③ 对 `/api/*` 的 POST/PUT/PATCH/DELETE 做 CSRF 校验（`Origin`/`Referer` 主机匹配 host 才放行）。另有 `STATIC_PREFIXES = ["/_next", "/fonts", "/images", "/videos"]` 直通（详见 [docs/gotchas.md](docs/gotchas.md) "资源与性能"段）。Edge runtime 不能 import Prisma，DB session 过期判定只能在下层做。
2. `lib/auth.ts`：暴露 `requireUser()` / `requireAdmin()`，所有写操作 API route 必须经过它。管理员判定 = `user.level >= ADMIN_LEVEL`（=100），**没有** `ADMIN_TOKEN` 环境变量，纯靠 DB 中的 level 字段。续期失败已 try/catch 记日志（不再静默吞）。
3. 登录流：POST `/api/auth/login` 传用户 token → 创建 Session 行 → 写 `gd_session` HttpOnly cookie。Session 7 天有效，支持滑动续期。**速率限制**：每 IP 60 秒内 5 次失败后返回 429，模式抄自 `app/api/vault/unseal/route.ts`。

**i18n 边界** —— Server Component 用 `lib/i18n/server.ts`，Client Component 用 `lib/i18n/client.tsx`，**两者不可混用**。语言偏好存 `locale` cookie，由 `/api/locale` 切换；字典在 `lib/i18n/dictionaries/{en,zh}/`。

**数据模型**（详见 `prisma/schema.prisma`）：

- `User` —— 含 RPG 属性字段（level/attack/defense/hp/agility/luck/specialAttributes），`SkillsRadar` 组件读这些字段渲染。
- `Activity` —— 用户动态，正文 ≤ 280 字符（`lib/validators.ts` 强制），关联 `User`。POST 接口对最近 5 秒内同 `userId+content` 自动去重（幂等），前端不要假定每次 POST 都新建。
- `Session` —— 登录会话。
- `Relic` —— 收藏品。状态机见"Relic 上传流水线 + 状态机"段。**关键列**：`primaryImagePath`（admin 选定的主图）、`enhancedImagePath`（fal.ai 抠图后的透明 PNG，3D 创建的入口）、`modelPath`（Meshy 输出 GLB）、`formKind` enum (`TWO_D` / `THREE_D`，建议默认 tab)、`formReason`（AI 判定理由）、`candidateImages` Json（draft pipeline 产出的全候选集 + admin 的 deleted/primary 状态）、`pipelineTrace` Json（最近一次 agent 调用的 runLog）、`loreZh/loreEn`（Markdown）。`photoPaths` 是 admin 手工 upload 用的老字段。
- `Agent` —— `/agent-control` 模块的 workflow / agent 实体，关键字段：`mode`（`MECHANICAL` 黄色 / `AUTONOMOUS` 青绿）、`avatarUrl` **NOT NULL**、`capabilities String[]`（admin 维护的能力标签 array，SceneBindingEditor 按"requiredCapabilities ⊆ agent.capabilities"过滤候选 agent）、4 项派生 stats（`chaosLevel/costTier/activityLevel/stabilityLevel`，全 0% 占位）、`pipelineConfig` Json?（v1 线性 / v2 DAG 双格式，详见 Skill Handler 段）、`dispatcherConfig` Json?（agent 中央槽 orchestrator 调度）、`deployedAt`、`status` enum `STANDBY / DEPLOYED / OFFLINE`（2026-05-15 改名 ONLINE → DEPLOYED；status 是生命周期的 single source of truth，`deployedAt ↔ status==DEPLOYED`，详见"Agent 生命周期"段）。详见下方"Agent Service + Forge Agents"段。
- `Skill` —— 可装备的能力定义（level 1-6，icon = Material Symbols 名）。CRUD 在 `/agent-control?tab=skills`。`kind` (HTTP_API/LLM_PROMPT/MCP_SERVER) 是 **runtime 路由字段**，决定 [`lib/skills/registry.ts`](lib/skills/registry.ts) 派给哪个 handler；徽章配色也派生自它。同时存的字段还有 `handlerConfig` Json（每个 handler 自己定义 shape）+ `inputSchema/outputSchema` Json?（JSON Schema，invoke 时校验 IO + 给 Orchestrator 转 LLM tool 定义）。SkillEditor UI 改成"What this skill does" preset 选择，raw `kind` 隐藏到 Advanced。**INTERNAL 已于 2026-05-11 整体退场**——业务编排走 HTTP_API + LLM_PROMPT + transform 组合。详见 [docs/skill-handler-system.md](docs/skill-handler-system.md)。
- `SceneBinding` —— 把 code-registered scene（`relic.enhance2d` 等）路由到某个 agent（scene -> agent 路由表）。字段：`sceneKey @unique` / `agentId` / `enabled Boolean` / `notes String?`。`onDelete: Restrict` on agent FK — 删 agent 前必须先 unbind。**纯路由表**——两次塑形都已下沉到代码层：(1) **outputMap 字段已于 2026-05-11 退场**，scene 输出契约改由 [`lib/relics/scenes.ts`](lib/relics/scenes.ts) 的 `outputSchema` 在代码层声明（authoritative，含 regex/enum/length 等结构性硬约束），agent 末尾 leaf 必须自塑形匹配该 shape；(2) **inputMap 字段已于 2026-05-12 退场**，ctx → agent.input 改由 scene 定义里的 `prepareAgentInput(ctx, actor)` 同步函数 own（`lib/<module>/scenes.ts` 内一同声明），默认 identity，需要重命名 / 注入 mode discriminator 时在函数里写。dispatch + runner 在两条路径上都对 leaf 输出做强制 outputSchema 校验，不符返回 `SCENE_OUTPUT_INVALID`，async 路径阻断 writeback hook。详见"Agent Service + Forge Agents"段。
- `AgentJob` —— async 调用历史，与 `RelicProcessingJob` 同模式。`mode` 字段是调用时刻的 agent.mode 快照（防 retry 飘移），`runLog` Json 是每步执行轨迹（数组），`maxAttempts=3`，状态机 `PENDING → RUNNING → SUCCESS|FAILED`。Crash recovery 由 [`lib/server-init.ts::ensureServerInit()`](lib/server-init.ts) 统一处理（与 RelicProcessingJob 同入口，10 分钟阈值）。`sceneKey` 列记录触发 job 的 scene（`relic.create3d` / `relic.enhance2d` 等），runner 用它派生 relic processing-log phase；直接 `invokeAgent` 留 null。
- `AgentSkillEquip` —— Agent ↔ Skill 多对多桥表，关键字段：`slotIndex` Int? (0..5) 标记装备到脊柱/大脑哪个槽；`unlocked` 锁/解锁标志。同一 agent 同一 slot 唯一性由 API 事务保证（`db push` 不支持 partial unique index）。每个 agent 的 equip 总数硬上限 = `SKILL_SLOT_COUNT`（=6），由 [POST /api/agents/[id]/skills](app/api/agents/[id]/skills/route.ts) 在事务里 count 校验，超出返回 409；slotIndex 允许为 null（[`SkillLibrary`](app/agent-control/components/SkillLibrary.tsx) 的快速 toggle 走这条路），但 null 行也计入上限。

**Prisma client** —— 通过 `lib/db.ts` 单例导出，避免开发热重载时连接泄漏。`postinstall` 自动 `prisma generate`。

## 路由速览

```
app/
  login/                — token 登录页
  admin/users/          — 管理员用户管理
  profile/              — 当前用户主页
  agent-control/      — Agent / Skill 装备界面（3 tab：agents 默认 / skills 库 CRUD / scenes 绑定）
  api/
    auth/{login,logout,me}
    users/[id]          — GET / PATCH / DELETE（写需 admin）
    activities/[id]     — GET / DELETE
    profile/            — PATCH 更新 bio
    locale/             — POST 切换语言
    agents/             — GET / POST，[id] PATCH（status=STANDBY/OFFLINE 触发 withdraw txn）/ DELETE，
                          [id]/skills POST/[skillId] PATCH-DELETE，
                          [id]/{pipeline,dispatcher} PUT，
                          [id]/deploy POST（生命周期事务：upsert binding + enable + status=DEPLOYED + stamp deployedAt），
                          [id]/invoke POST（异步建 AgentJob），
                          [id]/dry-run POST（同步，不建 job，编辑器 Test Run 用），
                          [id]/test-run POST（手动 smoke test，sceneKeys ⊆ intent ∪ binding，跑 scene.sampleCtx）,
                          [id]/jobs GET，[id]/jobs/[jobId] GET / [jobId]/retry POST，
                          [id]/export GET（自包含 JSON envelope），
                          import POST（codename + skill 冲突解析）
    scene-bindings/     — [sceneKey] PATCH（upsert binding + 同步两 agent 的 intentSceneKeys；agent capability ⊇ requiredCapabilities 校验）
                          [sceneKey]/sample-run POST（dry-run 跳过 runner，不写 AgentJob；SceneBindingEditor SAMPLE RUN 已改用 /api/agents/[id]/test-run）
    (2026-05-13 退役) internal/save-asset — 文件持久化改由 backbone `persist` 原语节点
                          在 runtime 进程内直调 [lib/relics/persistAsset.ts](lib/relics/persistAsset.ts)
    skills/             — GET / POST，[id] PATCH / DELETE，[id]/test-invoke POST
    relics/             — GET / POST 列表 + 创建
                          [id] GET / PATCH / DELETE
                          [id]/{model,primary,enhanced,derived,archive,photos/[i]} GET 资产流
                          [id]/candidate?path=<> GET 单候选图（in-set 校验）
                          [id]/candidate POST multipart 上传 user/network 候选 / JSON {imageUrl,sourceUrl} 手动添加 network 候选（admin 网络 modal "手动" tab）
                          [id]/lens-search POST admin "图片搜索" tab 触发；薄壳 → callScene("relic.network-image-search") → LENS-FORGE-001 → Vision API + Gemini 打分；同步返 {matches:[{imageUrl,sourceUrl,score,...}]}
                          [id]/job GET 最新 RelicProcessingJob（详情页轮询用）
                          [id]/jobs/[jobId]/retry POST 续跑指定 step
                          [id]/confirm POST AWAITING_REVIEW → READY（仅历史孤儿用）
                          [id]/enhance-2d POST 触发 cutout（异步 AgentJob）
                          [id]/create-3d POST 触发 Meshy（异步；要求 enhancedImagePath ≠ null）
                          [id]/regen-metadata POST admin「🔄 重新生成」（同步，返回预览不写库）
                          [id]/asset-job/[jobId] GET 上面两个异步触发的轮询端点
                          [id]/active-jobs GET 最新 enhance2d / create3d AgentJob（详情页刷新后恢复 running/error UI）
                          [id]/{extract,unlock,log} 老入口
    relic-drafts/       — GET 列出 admin 自己的 draft，POST multipart 创建 draft + 启动 draft pipeline
                          [id] GET / PATCH（编辑 generatedMetadata） / DELETE（放弃 + fs.rm workspace）
                          [id]/confirm POST 把 draft 转成 Relic（fs.rename + 事务建 Relic + 启 finalize pipeline）
                          [id]/retry POST 续跑（fromStep=GENERATE_METADATA / EXTRACT_ZIP）
                          [id]/{primary,candidate?path=<>} GET draft 阶段图片资产流
```

## 环境变量

复制 `.env.example` → `.env`（已在 `.gitignore`，**禁止 commit**）。最小集合：

```bash
DATABASE_URL="postgresql://gd_dev:gd_dev_local@localhost:5432/green_diva?schema=public"
ADMIN_TOKEN="..."             # seed 初始 admin token
SAFETY_SECRET="..."           # ≥32 字节，openssl rand -base64 32（详细影响范围见 docs/ops.md）。旧名 VAULT_COOKIE_SECRET 已弃用，本地 .env 若仍残留请改名
SECRET_DOOR_PASSWORD=""       # /vault 暗门 UI 输入的明文密码（与 SAFETY_SECRET 是两个独立 env，协作完成"密码 → 签 cookie"）
# ALLOW_PROD_SEED=1           # 生产环境强行运行 seed 才需要

# Forge agent 用 env（详见"Agent Service + Forge Agents"段；缺哪个对应 skill 就 fail）：
# GEMINI_API_KEY="..."        # LORE-FORGE 必填——loreEn (grounding+vision) + loreZh + metadata 三个 LLM_PROMPT skill；LENS-FORGE 的 vision-similarity-score 也用
# FAL_API_KEY="..."           # CUTOUT-FORGE 必填——fal.ai BiRefNet 抠图（HTTP_API skill，authScheme: "Key"）
# MESHY_API_KEY="..."         # MESHY-FORGE 必填——Meshy image-to-3D（HTTP_API skill，含 polling + download）
# SERPAPI_KEY="..."           # 2026-05-14 不再使用——PICKER-FORGE-001 已退役。env 名保留可作未来 SerpAPI 复用，目前 codebase 无依赖
# GOOGLE_CLOUD_VISION_KEY="..." # LENS-FORGE-001 必填——Google Cloud Vision API WEB_DETECTION 反向图片搜索（HTTP_API skill，authScheme: "QueryParam"）；缺则 admin 在 NetworkCandidateModal 搜索 tab 报错。GCP 项目里启用 Cloud Vision API 后创建 API key 即可
# ANTHROPIC_API_KEY="..."     # LLM_PROMPT skill provider=anthropic 时；AUTONOMOUS Orchestrator 也用
# OPENAI_API_KEY="..."        # 同上，provider=openai 时
#
# (2026-05-13 退役) INTERNAL_SERVICE_TOKEN —— HMAC-derived 内部 token 整体下线。
#   原来用它鉴权 /api/internal/save-asset 端点的链路 (HMAC 派生 + middleware 豁免)
#   全部移除；文件持久化改由 backbone `persist` 原语节点同进程直写。
```

## 本地与生产数据库

本地与线上**统一用 Postgres**（不再用 SQLite）。本地连本地实例，**绝不**把 `.env` 指向生产 DB。

安装步骤、日常命令、重置 dev 数据、生产运维约定（凭据隔离 / `pg_dump` 备份 / 最小权限账户 / `SAFETY_SECRET` 影响范围 / `db seed` 生产守卫）见 **[docs/ops.md](docs/ops.md)**。

`SAFETY_SECRET` 简记：server-side 安全 root，签 3 处 cookie + HMAC 派生 token lookup；轮换会让所有用户重登录。详细在 ops.md。

## Relic 上传流水线 + 状态机

跨 `lib/relics/pipeline/`、`app/api/relic-drafts/`、`app/api/relics/[id]/...`、`app/relic-collection/` 的子系统。**初次上传**只跑**轻量元数据生成**（~30 秒），admin 在 modal 里看到 AI 输出 → 编辑/确认/取消 → 确认后才创建 Relic 行。重资源操作（fal.ai 抠图 / Meshy 3D）改成详情页 tab 上**按需触发**。

**新流程（"上传到 RelicDraft，确认才落 Relic"）**：

```
admin 点 grid 空格子
  ↓
RelicDraftPanel 三阶段 modal:
  ① upload    POST /api/relic-drafts → 创建 RelicDraft（slot 锁定）+ runDraftPipeline
  ② waiting   3s 轮询 /api/relic-drafts/[id]，跑 EXTRACT_ZIP + GENERATE_METADATA
              writeback 到 RelicDraft.generatedMetadata（不创建 Relic）
  ③ preview   admin 编辑 / 选主图 / 删候选 →
              确认存入：POST /confirm → 事务建 Relic + fs.rename 工作目录 + runFinalizePipeline
              放弃：DELETE /api/relic-drafts/[id] → fs.rm + 删 RelicDraft（slot 释放）
```

**Pipeline 拆成两阶段**（[`lib/relics/pipeline/draft/runner.ts`](lib/relics/pipeline/draft/runner.ts) + [`lib/relics/pipeline/finalize/runner.ts`](lib/relics/pipeline/finalize/runner.ts)）：

```
Draft phase (RelicDraft):
  EXTRACT_ZIP (50%)         解 ZIP 或 multimodal 文件直接落 _drafts/<id>/source/extracted/
  GENERATE_METADATA (50%)   callScene("relic.generate-draft-metadata", { workspaceSlug })
                              → SceneBinding 路由到 RELIC-FORGE-001 (mode=initial 分支)
                              → agent 末尾 wrap-research transform 产出 { research: {...} }
                              → pipeline step 取 stageUserCandidates 中文件最大的 user 候选作 primaryImagePath
                              → 合并后 writeback 到 RelicDraft.generatedMetadata

Finalize phase (Relic, 由 confirm 触发):
  PACK_DERIVED (100%)       把 derived/* + 原文件 + metadata.json 打包；relic.status: PROCESSING → READY
```

**RelicDraft 状态机**：

| 状态 | 触发条件 | 视觉 |
|---|---|---|
| `PENDING` | 刚创建，pipeline 未开跑 | 草稿 cell 紫色（自己），灰色（别人） |
| `RUNNING` | pipeline 跑中 | 转圈 icon |
| `READY_TO_REVIEW` | EXTRACT + GENERATE 全成且 `degraded === false` | `edit_note` icon，"草稿待你确认" |
| `FAILED` | 任意 step 失败 / GENERATE 兜底 | `error` icon，"草稿生成失败" |
| `CANCELLED` | 中途被 DELETE 标记，等 fs cleanup | 短暂——通常立即被删 |

**「失败的草稿不会冒充成 pending review」**——同样不容妥协：runner finalize 读 `meta.degraded`，degraded → FAILED；只有完整 metadata 才进 READY_TO_REVIEW。

**Slot 占用**：

- `Relic.slot` @unique + `RelicDraft.slot` @unique，两表各自独立，但上传时 [POST /api/relic-drafts](app/api/relic-drafts/route.ts) 会同时检查两边
- Confirm 时 slot 从 RelicDraft 转移到新建 Relic（事务内）
- DELETE draft 释放 slot

**文件布局**：

- Draft 阶段：`private/relics/_drafts/<draftId>/{source/extracted/, derived/}` —— 路径前缀 `/_drafts/<draftId>/...`
- Confirm 时 `fs.rename` 整个目录到 `private/relics/<finalSlug>/`，路径前缀替换为 `/<finalSlug>/...`
- 元数据中 `primaryImagePath` / `candidateImages[].path` / `archivePath` 三处都要 path rewrite（confirm endpoint 处理）
- DELETE 走 `fs.rm(_drafts/<id>/, { recursive, force })` + DB 删行

**Pipeline 通用规则**：

- **Fire-and-forget**：`/api/relic-drafts` 创建 RelicDraft 后 `void runDraftPipeline(draftId)` 立即返回 201
- **顶层永不 throw**：runner 顶层 `try/catch` 把任何错误写到 `RelicDraft.errorMessage` + `status=FAILED`
- **自动重试**：runner 对瞬时错误（5xx / timeout / ECONN / EAI_AGAIN / "fetch failed"）退避至 `maxAttempts=3`
- **续跑**：`POST /api/relic-drafts/[id]/retry?fromStep=GENERATE_METADATA` 从指定 step 续跑；上游 step 结果从 `RelicDraft.stepResults` JSON 还原
- **Crash recovery**：[`lib/server-init.ts::ensureServerInit()`](lib/server-init.ts) 同时处理 RelicProcessingJob 和 RelicDraft 的 RUNNING 孤儿。**新加 job-creating endpoint 时也要调** `await ensureServerInit()`
- **进度 UI**：3 秒 setInterval 轮询 `/api/relic-drafts/[id]`，完成后 `router.push(/relic-collection/{newSlug})`

**详情页按需 tab**——AssetTabs 在图片区右上角放 3 tab（[`AssetTabs.tsx`](app/relic-collection/[slug]/_components/AssetTabs.tsx)）：

| tab | 状态 | 触发后 |
|---|---|---|
| `original` | 永远可点，渲染 `Relic.primaryImagePath` | — |
| `enhance2d` | admin 点「生成」→ POST `/enhance-2d` (薄壳 → `dispatchScene("relic.enhance2d", ...)`) | SceneBinding 路由到 RELIC-FORGE-001 (mode=2dEnhance 分支)；AgentJob 异步跑 fal cutout + `persist` 原语；runner 数据驱动 writeback hook 按 leaf output `_relicWriteback` 写 `Relic.enhancedImagePath` |
| `model3d` | **依赖 enhancedImagePath**，没有则 disable + 提示"请先生成 2D 增强"；有了点「生成」→ POST `/create-3d` | dispatchScene 路由到 RELIC-FORGE-001 (mode=3dCreate 分支)；AgentJob 异步跑 Meshy submit + poll + download + `persist` 原语（喂透明 PNG），写 `Relic.modelPath` |

## Relic 资料模型 + admin 编辑契约（2026-05-14）

跨 DB / agent prompt / API / 资料包打包的硬约束。改动这块前先看完。

**1. `Relic.materials` Json 列 + 文件落点**

- shape: `{ kind: "webpage"|"image"|"document"|"archive", url?, path?, originalName?, addedAt }[]`，max 20
- 文件路径: `private/relics/<slug>/materials/<kind>-<ts>-<rand>.<ext>`
- 端点: `POST /api/relics/[id]/material`（admin，50MB，三类扩展名白名单）+ `GET ...?path=&download=1`
- 改 kind 枚举 / 路径前缀 / 文件命名要同步 `lib/relicValidators.ts` + `OtherMaterialsGrid` + 资料包打包

**2. RARITIES 必须四处对齐**

`["COMMON", "RARE", "EPIC", "LEGENDARY", "SPECIAL"]` 同时出现在：

- `lib/relicValidators.ts`（`RARITIES` const）
- `lib/relics/scenes.ts`（draft-metadata + regen-metadata 的 outputSchema）
- `lib/skills/relic-prompts.ts`（DEFAULT_METADATA_PROMPT 的 JSON shape 段）
- Prisma `Rarity` enum

不一致 → agent 输出合法值被 scene outputSchema 拒，整条 draft pipeline `SCENE_OUTPUT_INVALID`。曾踩坑：scenes.ts 写成 `[COMMON, UNCOMMON, RARE, EPIC, LEGENDARY]`，agent 返回 SPECIAL 直接挂。

**3. SPECIAL 密码转换规则（两条入库路径必须一致）**

- `PATCH /api/relics/[id]`（编辑）：SPECIAL → 非 SPECIAL 自动 `passwordHash = null`；非 SPECIAL → SPECIAL 且无新密码 + 无遗留 hash → 400
- `POST /api/relic-drafts/[id]/confirm`（新增）：`meta.rarity === "SPECIAL"` 必带 password (≥4 chars)，bcrypt 12 rounds 哈希
- 前端 `RelicForm` + `DraftPreviewBody` 都按 `rarity === "SPECIAL"` 显隐密码输入框

任一端少一条 → 出现"创建/编辑能走通但密码丢失"或"SPECIAL 没密码就能存"。

**4. RelicForm 提交必须排除三个 path 字段**

`modelPath` / `archivePath` / `derivedArchivePath` 绝不 round-trip。三者各有严格 regex 验证（`/^\/[a-z0-9-]+\/derived-\d+\.zip$/` 等），不是表单字段，legacy 值往返触发 `VALIDATION_FAILED`。曾踩坑导致全部保存失败。

**5. 资料包打包目录契约（admin 下载工作流依赖，重命名前看清楚）**

- `GET /api/relics/[id]/archive`（原始资料包）: `source/` + `uploads/`（cand-user-* 后补图）+ `materials/` + `materials/urls.txt`
- `GET /api/relics/[id]/derived`（归档资料包）: `info/intro.md` + `candidates/` + `network/` + `materials/` + `materials/websites.md` + `enhanced/` + `model/` + `metadata.json`

**6. formKind / formReason 已彻底退场（2026-05-14）**

`Relic.formKind` / `Relic.formReason` 列 + `RelicFormKind` enum 全删（迁移 `migrate-drop-form-classification.ts`），scene outputSchema / DEFAULT_METADATA_PROMPT / runner writeback allowlist / AssetTabs 默认 tab 逻辑联动改完。AssetTabs 默认 tab 回退为 `enhanced > model3d > original`。看到老 commit / 老 prompt 提到 formKind 直接删，不要复活。

---

## Agent Service + Forge Agents

详见 **[docs/agent-service.md](docs/agent-service.md)**。要点：

- `dispatchScene` / `callScene` 是 site-wide 派发入口；endpoint 是薄壳（< 30 行），admin 在 `/agent-control?tab=scenes` 换 SceneBinding 即可换 agent，0 commit
- 三层路由：`scene.contextSchema → scene.prepareAgentInput → SceneBinding → executeAgent → scene.outputSchema`
- 当前 2 个 forge 覆盖 5 个**已绑定** `relic.*` scenes：**RELIC-FORGE-001**（4-way mode branch，绑 generate-draft-metadata / regen-metadata / enhance2d / create3d）+ **LENS-FORGE-001**（绑 network-image-search；Vision API WEB_DETECTION + Gemini per-candidate scoring；admin 在 RelicForm 网络候选 modal 触发）。**2026-05-15**：`relic.smart-image-pick` scene + PICKER-FORGE-001 整体彻底删除，draft pipeline 直接走 `stageUserCandidates` 的"最大 user 候选作主图"逻辑（无 agent 参与选图）
- backbone DAG 6 种节点：`skill` / `branch` / `loop` / `forEach` / `transform` / `persist`（后五种是 runtime 原语，不占装备槽）
- **责任边界**：Skill = 原子外部 IO；Agent = scene 契约塑形（末尾 transform 节点产 `_relicWriteback`）；runtime 原语 = 同进程基础设施
- 异步回写靠 [`runner.ts::maybeWriteRelicAsset`](lib/skills/runtime/runner.ts)：leaf output 含 `_relicWriteback: { id, fields }` → 按 15 字段 allowlist 写 Relic 列
- IO 留在 pipeline / endpoint 层（`scanWorkspace` / `readRelicImageAsDataUri` / `stageUserCandidates`），agent DAG 不再有 INTERNAL handler。详见 [docs/pipeline-input-pattern.md](docs/pipeline-input-pattern.md)


## Agent Control 装备界面（`/agent-control`）

赛博朋克 2077 风格的装备面板，承载站内所有 AI workflow（mode = `MECHANICAL`，黄色）和 AI agent（mode = `AUTONOMOUS`，青绿）。**不要创建 `/ai-clergy` 路由**——所有迭代统一在 `/agent-control` 下。

**命名层级（务必区分，三者重叠很容易混）**：

- **路由段**：`/agent-control`（固定字面量，不要拆）。
- **Mode 枚举**：`MECHANICAL` / `AUTONOMOUS`（DB enum，见 [prisma/schema.prisma](prisma/schema.prisma)）。下文若简写为 "machine 模式" / "agent 模式"，仅作叙述代称，**不要用作 DB / API 字段值**。
- **Tab key**：`agents` / `skills` / `scenes`（[`AgentClient.tsx`](app/agent-control/AgentClient.tsx) `TabKey`）。`agents` 下显示 roster 与详情；`skills` 下做 SkillLibrary CRUD；`scenes` 下编辑 SceneBinding。这里的 "agents" 指 tab 名，**不是** mode 名。Roster footer 有 Export ↓ / Import ↑ 按钮（导入返回 deployedAt=null 的 agent，admin 测试后 deploy）。

**单屏布局** —— ≥1024px 桌面端 100vh **不出现外部滚动条**，左 `lg:col-span-3` roster + 右 `lg:col-span-9` 详情区。详情区 5 块垂直堆叠：DetailHeader → BaseStatsBar（4 条 0% 进度条）→ EquipmentLoadout（核心，`flex-1 min-h-0`）→ ControlConfigStrip → DeployButton。布局骨架在 [`AgentClient.tsx`](app/agent-control/AgentClient.tsx)。

**槽位** —— 每个 Agent **有且只有 6 个 skill 槽** + 1 个中央 CONTROL 槽，绝对定位 + 百分比坐标，常量集中在 [`lib/agentControl/slotPositions.ts`](lib/agentControl/slotPositions.ts)：

> `SKILL_SLOT_COUNT = 6` 是**硬上限**也是**视觉契约**：UI 永远渲染 6 个槽位，多了塞不进去，少了视觉对称破坏。**留空合法**——RELIC-FORGE-001 slot 5、LENS-FORGE-001 slots 3-5 都空着（lens 只装 lens-reverse-search / download-network-image / vision-similarity-score 3 个 skill，其余靠 backbone `persist` + `transform` 原语）。看到 loadout 显示 `5/6` / `3/6` 不是"少装备了"，是"该位置由 runtime 原语接管"。**不要**因为想合并能力而把上限改大，也不要因为有空位就压缩槽数——破二者其一就破了 [`SkillConnections`](app/agent-control/components/SkillConnections.tsx) 的 PCB trace 布局。

- machine（脊柱）—— 3×2 网格左右对称（top 18% / 50% / 82%，left 18% / 82%）；背景 `/public/images/agent-control/spine.jpg`，缺图自动 fallback `spine.svg`。
- agent（大脑）—— 圆弧排列 6 点；背景 `/public/images/agent-control/brain.jpg`，缺图 fallback `brain.svg`。
- **资产路径必须在 `/public/images/` 下**——`/agent-control/*` 跟同名 page route 冲突，被 middleware 鉴权拦截，Next.js Image 优化器拿不到（详见"资源与性能"段的"静态图与 middleware 鉴权"）。
- 未来要基于上传图切割自动调对齐时只改这一个文件，签名预留 `getLoadoutLayout(mode)`。

**Agent 命名结构（4 字段双语对）** —— 编辑表单上呈现两组：

- **Name 对**：`codename`（slug，uppercase / digits / dash，如 `DIVA-001`）+ `codenameZh`（中文身份名，可空）—— 唯一标识。
- **Role 对**：`nameEn` + `nameZh` —— 角色 / 职能描述（如 `Neural Operator` / `神经网络接线员`）。DB 字段名是 `name*`，别误把 `nameEn` 当作技术 ID。

**⚠️ 中央槽不是 skill** —— 它存的是"如何调度 6 个 skill 协作运行"的配置：

- machine 中央 = **Backbone**，对应 `Agent.pipelineConfig` Json（workflow 节点 / 连线 / 参数）
- agent 中央 = **Orchestrator**，对应 `Agent.dispatcherConfig` Json（AI 调度策略 / 模型 / prompt）

数据上是 Json 字段，**不是 skillId 外键**。UI 上中央槽点击弹编辑器：MECHANICAL 走 [`BackboneFlowEditor`](app/agent-control/components/BackboneFlowEditor.tsx)（React Flow 画布，可视化 DAG），AUTONOMOUS 走 [`OrchestratorEditor`](app/agent-control/components/OrchestratorEditor.tsx)。SkillLibrary CRUD（`tab=skills`）只管 skill 自身能力定义，与中央槽互不重叠。改这块务必保持边界。

**Skill 是 mode-agnostic 的统一资产** —— 一条 Skill = 一个"带类型签名的可调用单元"，**不属于** MECHANICAL 或 AUTONOMOUS 任何一边，两类 agent 共用同一张 Skill 表 + 同一个 SkillLibrary（已验证：[`prisma/schema.prisma`](prisma/schema.prisma) `model Skill` 无 mode 字段，[`AgentSkillEquip`](prisma/schema.prisma) 桥表无 mode 校验，[`/api/skills`](app/api/skills/route.ts) 不按 mode 过滤）。**绝不**在 Skill 表加 mode 字段或建"MECHANICAL-only / AUTONOMOUS-only"的子集——这违反统一资产的设计意图。

mode 差异**只活在 Agent 层**，决定"如何串联 skills"：

- MECHANICAL → `pipelineConfig` 描述线性 / DAG workflow，Backbone 按图调度，skill 作为节点
- AUTONOMOUS → `dispatcherConfig` 描述 LLM 调度策略，Orchestrator 把 skills 作为 tools 喂给模型，由模型决定何时调

**UI 用语统一**——面向用户的所有可见文本：MECHANICAL 模式统称 **Backbone**（"Backbone Config" 卡片 / footer "Backbone : Success/Pending"），AUTONOMOUS 模式统称 **Orchestrator**。新加文案 / 模态保持这一边界。（本文档叙述层仍用"中央槽"指代该位置，是文档内部代称，与 UI 文案规则无关。）

**Skill.status 字段（ONLINE / OFFLINE，默认 ONLINE，admin 手动 toggle）** —— 单条 skill 的可用性。三处 UI 直接消费：

- [`SkillConnections.tsx`](app/agent-control/components/SkillConnections.tsx) 装备线颜色：empty → 灰、equipped+OFFLINE → 灰、equipped+ONLINE → mode 主色（金 / 青绿）。
- [`SkillDetailCard.tsx`](app/agent-control/components/SkillDetailCard.tsx) 右栏每行徽章直接显示 `ONLINE` / `OFFLINE`（绿 / 灰）。
- [`DetailHeader.tsx`](app/agent-control/components/DetailHeader.tsx) MECHANICAL / AUTONOMOUS 徽章：所有装备 skill 中无 ONLINE 时灰底，否则 mode 主色。

页面 server data 通过 [`app/agent-control/page.tsx`](app/agent-control/page.tsx) 序列化（`skills` 与 `equipsByAgentId.skill` 都要带 `status`）。新加任何展示 skill 的 UI 别忘了透传这个字段。

**SkillConnections 装备线（PCB trace）** —— [`SkillConnections.tsx`](app/agent-control/components/SkillConnections.tsx) 在装备背景图上叠 SVG，渲染 6 个 skill 槽到中央槽 + 同列槽位之间的连线（左右两根纵向 trunk + 6 条 elbow / 横线）。坐标从 `slotPositions.ts` 的百分比派生，viewBox 0 0 100，`preserveAspectRatio="none"` 拉伸。每条 trace 双层 stroke：暗色 halo 在下做对比 + mode 色 stroke 在上发光。**重要**：`<filter>` 必须用 `filterUnits="userSpaceOnUse"` + 绝对坐标，**不要**用默认 `objectBoundingBox`——纯水平 / 纯垂直线 bbox 高 / 宽为 0，filter 区域塌陷成空，彩色 stroke 整段不渲染（只剩 halo 看着像灰）。这条规则适用于以后任何用 SVG `<filter>` 处理 axis-aligned 线 / 单点的场景。

**派生 stats 占位** —— `chaosLevel / costTier / activityLevel / stabilityLevel` 当前都返回 0%，UI 显示"⏳ pending derivation"。算法待实现于 `lib/agents/derived.ts`（TODO）。

**调用层** —— 详见 [docs/skill-handler-system.md](docs/skill-handler-system.md) + 下方"Skill Handler 与运行时"段。三层调用栈：[`lib/agents/invoke.ts`](lib/agents/invoke.ts) 按 `agent.mode` 分发到 [`lib/skills/runtime/backbone.ts`](lib/skills/runtime/backbone.ts)（MECHANICAL，线性 pipeline）或 [`lib/skills/runtime/orchestrator.ts`](lib/skills/runtime/orchestrator.ts)（AUTONOMOUS，LLM tool-use loop，Anthropic + OpenAI）。**Deploy 现在是完整生命周期事务**（2026-05-15 改造，详见下方"Agent 生命周期与 Deploy / Test Run"段）——不只是 stamp `deployedAt`，还会 reconcile SceneBinding + flip `status=DEPLOYED` + enable bindings；真实调用仍走 `POST /api/agents/[id]/invoke`（异步，建 AgentJob）或 `POST /api/agents/[id]/dry-run`（同步，编辑器用）或 `POST /api/agents/[id]/test-run`（手动 smoke test）。

**主色绑定 mode** —— machine = `secondary` (#e9c176 金黄)，agent = `primary` (#90decd 青绿)。新 UI 子组件接 `agent.mode` 切两套配色，不要硬编码颜色。**Tailwind 不能动态拼类名**——必须 `isMech ? "text-secondary border-secondary/40 ..." : "text-primary border-primary/40 ..."` 整段硬编码两套，写 `text-${accent}` 会被 PostCSS 干掉。需要 RGBA/hex（如 SVG stroke、内联 style）时从 [`lib/agentControl/theme.ts`](lib/agentControl/theme.ts) 取 `MECH_RGBA`/`AGENT_RGBA`/`themeHex(mode)`——单一 source of truth，不要在组件里散落 magic color。

**新建 agent 默认 mode = AUTONOMOUS**（[AgentEditor.tsx](app/agent-control/components/AgentEditor.tsx) `blankFromInitial`），因此首屏中央槽 = **Orchestrator**（消费 `dispatcherConfig`），背景图走大脑、主色青绿。注意 Prisma schema 里 `Agent.mode` 列默认是 `MECHANICAL`——这是 DB 兜底，**不**是新建 UI 的入口默认。

**Runtime 配置统一走中央槽**：machine 进 `pipelineConfig`，agent 进 `dispatcherConfig`，不要往 Agent 表加扁平的运行时字段。Agent 派生 stats（chaos/cost/activity/stability）+ syncLevel/matrixLevel/availableAp 字段保留给未来 auto-calc 服务（`lib/agents/derived.ts` TODO），Editor 不暴露——别在编辑表单里加这几个字段的 input。

**Agent portrait 上传** —— 走 [`/api/agents/avatar/upload`](app/api/agents/avatar/upload/route.ts) multipart endpoint，admin-only。前端选文件 → [`AvatarCropModal`](app/agent-control/components/AvatarCropModal.tsx)（`react-easy-crop` 依赖）按 **131:304 ≈ 0.4309** 比例裁切（与 hero portrait 外框一致）→ canvas 转 JPEG Blob → 上传。endpoint 不校验 mime/ext/size（已裁切过），只验 admin auth。返回相对路径 `/images/agent-control/avatars/<ts>-<rand>.<ext>`。

**`avatarUrl` validator 接受两种格式** —— `http(s)://...` **或** `/`-开头的绝对路径（[`lib/validators.ts`](lib/validators.ts)）。本地上传走后者，远程 URL 走前者。**别**回退成 `z.string().url()`——会拒绝所有上传后的路径。

## Agent 生命周期与 Deploy / Test Run（2026-05-15 改造）

跨 `app/api/agents/[id]/{route,deploy,test-run}.ts`、`app/api/scene-bindings/[sceneKey]/route.ts`、`app/agent-control/components/{DeployButton,TestRunButton,AgentEditor,DetailHeader}.tsx` 的子系统。一次完整改造，**改任意一段都需要联动整链**。

### 1. 生命周期：`Agent.status` 是单一 source of truth

- enum 改名：`ONLINE → DEPLOYED`（[migrate-rename-agent-status.ts](prisma/migrate-rename-agent-status.ts) 单条 `ALTER TYPE`，2026-05-15 已上线）。**别再写 `"ONLINE"` 作 AgentStatus 字面量**（Skill.status 仍是 ONLINE/OFFLINE，是两套不同的 enum）。
- 三档语义：

| status | deployedAt | SceneBindings | UI 表现 |
|---|---|---|---|
| `STANDBY`（新建默认） | null | 不存在 | "TO DEPLOY" 按钮（mode 色） |
| `DEPLOYED` | 非空 | enabled=true | "DEPLOYED"（绿，disabled）/ "RE-DEPLOY"（dirty 时） |
| `OFFLINE` | null | 不存在 | "OFFLINED"（红，disabled） + 整个面板灰化 |

- `intentSceneKeys` 任何状态下都保留，是 admin 在 Tune Agent 勾选的草稿声明；deploy / un-deploy 不动它。

### 2. PATCH 端点的特殊事务（[/api/agents/[id]/route.ts](app/api/agents/[id]/route.ts) PATCH）

普通字段 patch 与一般 Prisma update 一样；**当 `status` 改为 STANDBY 或 OFFLINE 且当前 `deployedAt` 非空** → 进入 withdraw txn：删除该 agent 的所有 SceneBinding + 清 `deployedAt` + 设新 status，原子提交。`OFFLINE` 路径在 AgentEditor 客户端 `window.confirm()` 二次确认；`STANDBY` 不确认。

### 3. Deploy txn 详解（[/api/agents/[id]/deploy/route.ts](app/api/agents/[id]/deploy/route.ts) POST）

**没有内联测试闸门**（2026-05-15 拆除）。流程：

1. Pre-flight conflicts：扫 intent 涉及的 SceneBinding 行，filter 出 `agentId !== this.id` 为 takeover。有 takeover 且 `confirmTakeovers !== true` → 409 + `takeovers[]`。
2. 计算 orphans：`agent.id` 拥有但 `sceneKey ∉ intentSceneKeys` 的 binding（来自反勾 / 已退役 scene）。
3. 单 txn：
   - 删 orphan SceneBinding 行
   - 对每个 `intentSceneKey` upsert：存在 → `agentId = this.id, enabled = true`；不存在 → create with `enabled = true`。**deploy 时强制 enable**，admin 不用再去 Scenes tab 手动启用。
   - 写 Agent：`{ deployedAt: now, updatedAt: now, status: "DEPLOYED" }` —— `updatedAt` 与 `deployedAt` 同时刻显式 pin（不让 Prisma `@updatedAt` 自带新 `new Date()`），否则 client `dirty = updatedAt > deployedAt` 会因为几毫秒差立刻判定为 RE-DEPLOY。

### 4. Tune Agent 改 STATUS = DEPLOYED 的快捷路径

[AgentEditor.tsx](app/agent-control/components/AgentEditor.tsx) onSubmit 检测到 `values.status === "DEPLOYED" && initial.status !== "DEPLOYED"`：
- **从 PATCH body 里抽掉 status 字段**（让 deploy endpoint 自己 flip，不允许直接把 STANDBY 改 DEPLOYED 而不走 binding txn）
- 调 `onRequestDeploy(agentId)` → [AgentClient.tsx](app/agent-control/AgentClient.tsx) 设 `{ agentId, nonce: Date.now() }` → 把 `autoOpenNonce` 透传给当前选中 agent 的 DeployButton → DeployButton `useEffect` 监听 nonce 变化 → 自动打开 confirm modal。

这个 nonce 增量是为了同 agent 二次触发也能重新弹（同值不重发 effect）。

OFFLINE → DEPLOYED 同样走这条路径（`wantsDeploy` 条件只看"不是 DEPLOYED"）。

### 5. PATCH SceneBinding 的 intent 双向同步（[/api/scene-bindings/[sceneKey]/route.ts](app/api/scene-bindings/[sceneKey]/route.ts) PATCH）

admin 在 Scenes tab 把 scene 从 agent1 改绑到 agent2，事务里同步三件事：
- upsert SceneBinding（agentId / enabled）
- 旧 agent.intentSceneKeys 删 sceneKey（如还在）
- 新 agent.intentSceneKeys 加 sceneKey（如不在）

**目的**：避免"binding 飘到 agent2 但 agent2 的 intent 没声明"。否则下次 agent2 re-deploy 会把这条 binding 当 orphan 删掉。

### 6. Test Run（[/api/agents/[id]/test-run/route.ts](app/api/agents/[id]/test-run/route.ts) POST）

**独立于 deploy 的手动 smoke test 入口**。body `{ sceneKeys: string[] }`（max 10）。范围：`intentSceneKeys ∪ liveBindings` —— 草稿状态也能测（intent-only scene 没 live binding 也允许，便于 deploy 前预热）。

入口前调 [`ensureSmokeFixtures()`](lib/relics/smokeFixtures.ts) 幂等写 `/tmp/_smoke-test-ref.png`（1×1 PNG）。每个 scene：解 sampleCtx → prepareAgentInput → `executeAgent` → 收集 `{ ok, durationMs, errorCode?, errorMessage?, runLog?, output? }`。20 分钟单次 timeout（覆盖 Meshy 最坏 case）。

### 7. Scene sampleCtx + smokeFixtures

[lib/relics/scenes.ts](lib/relics/scenes.ts) 所有 5 个 scene 都有 `sampleCtx`，但形态分两类：

- **纯 LLM 路径**（regen-metadata / generate-draft-metadata）：字面量 ctx，Gemini API 直接吃
- **需要真实图片**（enhance2d / create3d / network-image-search）：用 [`SMOKE_PHOTO_DATA_URI`](lib/relics/smokeFixtures.ts)（128×128 JPEG 红圆灰底）。**1×1 PNG 不行** —— fal.ai BiRefNet / Meshy 都会拒绝 unloadable image，必须用真实可分割的图。

`network-image-search` 还需要 fs 文件（Gemini vision skill 通过 `imagePathsField` 读盘），所以 `ensureSmokeFixtures()` 写一份 1×1 PNG 到 `/tmp/_smoke-test-ref.png`。test-run endpoint 入口幂等调用。

新加 scene 想纳入 smoke test：在 scene 定义里加 `sampleCtx`（必须满足 contextSchema），如果需要 fs 文件就扩展 `smokeFixtures.ts`。**没 sampleCtx 的 scene 自动 skip**（test-run 返回 `{ skipped: true, reason: "no sampleCtx defined" }`），向后兼容。

### 8. UI 配色约定

DeployButton 4 个视觉状态对应不同生命周期：

| 状态 | 边框/文字/底色 | 图标 | disabled? | 触发条件 |
|---|---|---|---|---|
| OFFLINED | rose-400 | `block` | ✅ | `status === "OFFLINE"` |
| DEPLOYED | emerald-400 | `check_circle` | ✅ | `deployedAt && !dirty` |
| RE-DEPLOY | mode accent | `rocket_launch` | ❌ | `deployedAt && dirty` |
| TO DEPLOY | mode accent | `rocket` | ❌ | `!deployedAt && status !== "OFFLINE"` |
| DEPLOYING… | mode accent | `progress_activity` (spin) | ✅ | `busy` |

OFFLINE 时整个详情面板（除 EDIT 按钮外）加 `opacity-50 grayscale pointer-events-none`，但 DeployButton 和 OFFLINE 红色徽章 **不被父级 dim wrapper 包裹** —— 它们的颜色就是 OFFLINE 信号本身，被灰化反而丢失语义。

DetailHeader 顶部 status badge 颜色：DEPLOYED emerald / STANDBY amber / OFFLINE rose（[DetailHeader.tsx](app/agent-control/components/DetailHeader.tsx)）。

### 9. SceneBindingEditor（Scenes tab）UI 改造

- ENABLED / DISABLED 改为 segmented control（双 button radio，emerald / rose 配色），跟 AGENT dropdown 同行同高（`h-[44px]`）。
- NOTES 列退役（UI 层；`SceneBinding.notes` DB 列仍在，PATCH 接口仍接收，避免数据丢失）。
- SAMPLE RUN 段不再要 admin 输 JSON，复用 test-run 端点（POST `/api/agents/[id]/test-run` body `{ sceneKeys: [scene.key] }`），结果用 `SampleResultPanel` 内联渲染（PASS/FAIL/SKIP 徽章 + 耗时 + errorMessage + runLog tail + 可折叠 output JSON）。
- CONTEXT / OUTPUT 标题改名："Scene → Agent · input" / "Agent → Scene · output" —— 明示数据流向。

## Skill Handler 与运行时

完整设计：[docs/skill-handler-system.md](docs/skill-handler-system.md)。本节仅列**改动会破坏全链路的硬规约**。

**三层调用栈**：编排器（agent 层）→ skill（资产层）→ handler（调用层）。**不可跨层硬连**——加新具体能力走 DB 配置（UI 操作），加新 handler 类型 / 编排器类型走 git PR。

**绝对不要做的事**：

1. **永远不要做 ZIP 上传插件**。Skill = "数据 + 配置"（DB 一行），不是"上传可执行代码"。这条决定刻进设计——破它就是 RCE / 沙箱 / 依赖管理 / 版本撤销 等大坑。复杂 AI agent 走 MCP 协议或独立服务（远程 endpoint），不要塞进主站进程。
2. **`handlerConfig` 永远不能含明文 secret**。[`lib/validators.ts`](lib/validators.ts) `PLAINTEXT_SECRET_RE` 已用正则拒绝 `apiKey/secret/token/password/bearer/access_key` 等键名。Secret 走 env，`handlerConfig.authEnv` 只存 env 名。改 validator 时保住这条 refine。
3. **`AgentRunResult` 是 discriminated union（success | failure），不要回退成 throw**。[`lib/skills/runtime/runner.ts`](lib/skills/runtime/runner.ts) 依赖此契约：失败时 `runLog` 仍能写进 DB，让 `AgentJobDrawer` 显示"step N 哪一步炸了"。改 invoke 签名要联动 runner + backbone + orchestrator 三处。
4. **`PUT /api/agents/[id]/{pipeline,dispatcher}` schema 是严的**（[`pipelineConfigSchema`](lib/validators.ts) / [`dispatcherConfigSchema`](lib/validators.ts)）—— `BackboneFlowEditor` / `OrchestratorEditor` 是它们唯一的写入者。手工 curl raw JSON 会被拒。
5. **Runner 的 `maybeWriteRelicAsset` writeback hook 是 relic-bound 异步调用的唯一回写路径**（[`lib/skills/runtime/runner.ts`](lib/skills/runtime/runner.ts)）。Agent leaf output 必须含 `_relicWriteback: { id, fields }`（由 agent 末尾 transform 节点产出，scene outputSchema 用 `.passthrough()` 让该字段穿过校验），fields 走 `ALLOWED_WRITEBACK_FIELDS` 白名单。新增异步回写目标 = 加白名单字段 + 让 agent 产出对应 `_relicWriteback`，不动 runner 代码。**不要**依赖 `input.mode` 字段做回写路由。
6. **不要把 scene 输出契约塞进 DB**。Scene 期望的 output shape 必须在 [`lib/relics/scenes.ts`](lib/relics/scenes.ts) 用 Zod `outputSchema` 声明，agent 末尾 leaf 自塑形匹配该 shape。退路是"`SceneBinding.outputMap` 在 DB 里塑形" —— 已于 2026-05-11 退场，admin 改 agent 内部 node id 时静默断链；不要复活。
7. **不要让 skill 知道业务概念**。Skill = 原子 IO（一次 HTTP / 一次 LLM），responseTransform 只产 raw 响应字段；**`_relicWriteback` / scene-shape 字段都属于 agent 的封装层**（末尾 `transform` 节点用 JSONata 组装）。skill 不应该出现 `enhancedImagePath` / `modelPath` 这类业务字段名——那样 skill 就锁死在某个 scene 上，复用性归零。详见"Skill / Agent 责任边界"段。
8. **数据持久化是 runtime 原语，不是 skill**。2026-05-13: 把 base64 写到 `private/relics/<slug>/derived/` 由 backbone `persist` 节点直调 `lib/relics/persistAsset.ts` 完成。**不要**把它再做成 HTTP_API skill 调一个 `/api/internal/save-asset` endpoint——那是已经退役的反模式，套了 HMAC token 鉴权环路又占着 skill 槽，违反 "skill = 外部能力 / persist 是基础设施" 的边界。

**代码组织**：

- `lib/agent-service/` —— scene 分发层：`registry.ts` / `template.ts` / `dispatch.ts` / `serialize.ts` / `types.ts` / `index.ts` (barrel)。模块在 `lib/<module>/scenes.ts` 调 `registerScene(...)`，`lib/scenes-init.ts` 中央 import 触发副作用。
- `lib/skills/handlers/` —— handler 实现：
  - `httpApi.ts` —— 通用 REST 调用器。支持 `polling` (intervalMs/timeoutMs/successWhen/failureWhen) + `download` (urlPath → base64 + content-type) + `responseTransform` (template scope = `{ input, response }`) + `responseType: "json"|"text"|"binary"`（binary 模式直返 `{ base64, contentType, bytes, url }`，shared download-network-image skill 用此）。authScheme: `"Bearer"|"ApiKey"|"Key"|"Basic"|"Header"|"QueryParam"`（"Key" 是 fal.ai 风格 `Authorization: Key <key>`；"QueryParam" 把 env 值附加到 URL 作 query 参数）
  - `llmPrompt.ts` —— **Anthropic + OpenAI + Gemini 三 provider**。Gemini 含 `grounding` (Google Search 工具) + `responseFormat: "json"` + `imagePathsField` (vision，all 3 providers 共用)。grounding 与 JSON-mode 冲突时 grounding 赢，自动 fallback 到 text mode；citations 透传到 `_citations`
  - `mcpServer.ts` —— 占位

  **INTERNAL handler 已于 2026-05-11 整体退场**——`SkillKind` enum、registry、UI、validator 全部不再认 `INTERNAL`。**不要再加 INTERNAL handler**：业务编排走 backbone 原语，IO primitive 走 pipeline / endpoint 层（参考 `scanWorkspace` / `readRelicImageAsDataUri` / `stageUserCandidates`）。
- `lib/relics/persistAsset.ts` —— `persist` 原语调用的 in-process FS 写入 helper（替代 2026-05-13 退役的 `/api/internal/save-asset` endpoint + `lib/internal-token.ts`）
- `lib/skills/relic-prompts.ts` —— DEFAULT prompt 常量（无 `server-only`，让 migrate scripts import）
- `lib/skills/registry.ts` —— HandlerKind → handler 函数映射
- `lib/skills/invoke.ts` —— 单次调用入口（input/output JSON Schema 校验）
- `lib/skills/runtime/{backbone,orchestrator,runner}.ts` —— 编排器 + async runner（含数据驱动 writeback hook）。`backbone.ts` 是入口 shell，引擎拆到 `lib/skills/runtime/backbone/{validate,refs,types,executors/}.ts`（每个 node type 一个 executor 文件）。`BackboneFlowEditor.tsx` 同样是入口 shell，子组件在 `app/agent-control/components/backbone/{nodes,panels,BodySubCanvasEditor,serialize,topology,types}/`
- `lib/agents/invoke.ts` —— mode 分发器，dry-run 用 `pipelineConfigOverride` / `dispatcherConfigOverride` 形参注入未保存的 config

**dispatcherConfig shape**（AUTONOMOUS）：`{ version: 1, provider: "anthropic"|"openai", model, systemPrompt?, maxIterations?, temperature?, authEnv?, outputMode? }`（gemini provider 仅 LLM_PROMPT skill 支持，Orchestrator 暂未扩）。

**outputMode**（2026-05-12 加，让 AUTONOMOUS 能接管复杂 scene 契约）：
- `"text"` (默认) → agent output = `{ text, iterations, toolCallCount }`。free-form 对话 / 研究类 scene 用，scene.outputSchema 一般校验不过（除非 scene 显式接 `{ text }` shape）。
- `"json"` → orchestrator 末尾尝试 `JSON.parse(out.text.trim())`（带 ```json 围栏剥离）。成功时 parsed 对象直接成 agent output，可被 scene.outputSchema + writeback hook 消费；失败 fallback 到 text 信封 + 写 `OUTPUT_NOT_JSON` / `OUTPUT_PARSE_FAILED` 到 runLog。**systemPrompt 运行时自动追加** "只许 JSON / 无 markdown / 无 prose" 后缀。
- 可靠性权衡：依赖 LLM 守规矩。简单 sync scene（输出 5-10 字段 flat shape）可用；CUTOUT/MESHY 这种带 `_relicWriteback` 的关键路径仍建议 MECHANICAL —— 确定性 transform 节点比 LLM 自描述 JSON 稳得多。

**AUTONOMOUS 装备 skill 必须先补 `inputSchema`**（容易踩的坑）：

- MECHANICAL 通过 DAG 节点的 `inputFrom` 在 backbone 层规定 skill 入参（admin 拖连线），skill 自身的 `inputSchema` 可以为 null —— 现有 forge skill 全是这样。
- AUTONOMOUS 把 skill 转成 LLM tool schema 时**直接读 `Skill.inputSchema`**，缺省 fallback 到 `{ type: "object", properties: {} }` —— LLM 看到工具名 + description 但不知道传什么参数名，**只能瞎猜**，多数 case 会陷入"调失败 → 重试 → maxIterations"循环。
- 设计哲学差异：MECHANICAL 视角 = "skill 是零件，admin 在 DAG 规定怎么连"；AUTONOMOUS 视角 = "skill 是 LLM 自治调用的 tool，必须自描述完整"。
- **要让既有 forge skill 被 AUTONOMOUS agent 复用**：去 SkillLibrary 给每条 skill 补 `inputSchema`（JSON Schema），描述参数名 + 类型 + required。**不需要改代码**——纯 admin 配置。新建 skill 建议**默认就把 inputSchema 写上**，让它两种 mode 都能用。
- 同理 `Skill.descriptionEn` 在 AUTONOMOUS 模式下被当成 LLM tool description 直接读，写法要面向"模型读完知道何时调用"而非"admin 看名字"。

**pipelineConfig shape**（MECHANICAL）：**v1（线性）和 v2（DAG）双版本支持**。validator [`pipelineConfigSchema`](lib/validators.ts) 是 union，runtime [`backbone.ts`](lib/skills/runtime/backbone.ts) 自动把 v1 normalize 到 v2 内部表示，所以执行只有一份代码。

- **v1**（legacy）：`{ version: 1, steps: [{ id, equipSlot, inputMapping: { from: "agent.input"|"<id>.output" } }] }`
- **v2**（DAG）：`{ version: 2, nodes: [...], edges: [{ from, to, when? }] }`，节点 **6 种** type：
  - `skill`：`{ id, type: "skill", slotIndex, inputFrom, position? }`
  - `branch`：`{ id, type: "branch", inputFrom, cases: [...], defaultLabel?, position? }`
  - `loop`：`{ id, type: "loop", inputFrom, maxIterations: 1-10, exitWhen?: BranchCase[], body: { nodes, edges } 自包含 sub-DAG, aggregate?: "last"|"concat-array", position? }`
  - `forEach`：`{ id, type: "forEach", inputFrom, maxItems: 1-50, body: { nodes, edges } 自包含 sub-DAG, aggregate?: "last"|"concat-array" (默认 concat-array), position? }`。Body 入口 `agent.input = { item, index, total }`。共享 `MAX_LOOP_DEPTH=2` 预算。
  - `transform`：`{ id, type: "transform", inputFrom, expression: string (≤4000 chars), position? }`。`expression` 是 [JSONata](https://docs.jsonata.org)，validateAndNormalize 时 parse-once；运行时 `await jsonata(expression).evaluate(input)`。无 sub-DAG / 无外部调用。
  - `persist` (2026-05-13)：`{ id, type: "persist", inputFrom, position? }`。inputFrom 解析为 `{ relicSlug, kind, base64, contentType?, ext? }`，输出 `{ savedPath, absPath, bytes, contentType }`。同进程写盘原语，取代旧 save-asset skill。
- **v2 source ref 语法**：除了 `"agent.input"` / `"<nodeId>.output"`，还支持**子路径**（`"summary.output.relicSlug"`）和**多源 merge**（`{ merge: { keyA: "<refA>", keyB: "<refB>" } }`）。修 source ref 解析必须联动 backbone runtime 的 `parseSourceRef` + `splitRef`
- **v2 branch**：节点可作为根（无入边即 live），`cases: [{path, op: "eq"|"ne"|"in"|"exists", value, label}]`，`defaultLabel` 可选；不写 defaultLabel 且没 case 命中 → `BRANCH_NO_MATCH` 失败
- **v2 子分支跳过语义**：被 branch 不选的下游节点 `skipped: true` 进 runLog；引用它输出的 merge 字段解析为 `null`
- **v2 loop**：body 是 self-contained sub-DAG（独立 topo / 独立 source ref scope）。每次 iteration 用前次 leaf output 作下次 input。`MAX_LOOP_DEPTH = 2`，body.nodes ≤ 20 / edges ≤ 40。runLog 中 body 节点 stepId 前缀 `<loopId>#<iterN>/`。Loop 输出按 aggregate 模式取 last 或 concat array
- `equipSlot` 而非 `skillId`——换装时 pipeline 不会 dangling

**Backbone 编辑器是 React Flow** —— [`BackboneFlowEditor.tsx`](app/agent-control/components/BackboneFlowEditor.tsx) 6 种节点（SkillNode 金 / BranchNode 珊瑚红 / LoopNode 紫 double-border / ForEachNode 天蓝 / TransformNode 翠绿 / PersistNode 琥珀色）+ LabeledEdge；位置写到 `pipelineConfig.nodes[].position`，下次进来同布局。Test Run 在侧栏，dry-run 整个 DAG。Loop / forEach 的 body 通过 `BodySubCanvasEditor` 嵌套 modal 编辑（kind prop 区分）；sub-canvas 内只有 skill/branch/transform/persist，**禁止嵌套** loop/forEach（runtime 仍支持 depth 2，admin 可走 Advanced raw JSON）。

**SkillEditor / BackboneFlowEditor / OrchestratorEditor 都有 Test Run/Test Invoke 按钮**，分别打 `POST /api/skills/[id]/test-invoke` 或 `POST /api/agents/[id]/dry-run`（接受 config override，同步执行不建 AgentJob）。Production 调用走 scenes 分发（`callScene` / `dispatchScene`），admin 直接 `POST /api/agents/[id]/invoke`（异步建 job）也仍可用。改前者 / 后者契约时要联动编辑器。

**SkillEditor "What this skill does" preset** —— 7 个预设（LLM × 3 provider / HTTP × 3 形态 / MCP），每个含 `defaultConfig` scaffold。`derivePresetKey()` 启发式从现有 skill 反推 preset。raw `kind` 在 Advanced 模式编辑。（旧 "save-asset" preset 已于 2026-05-13 删除——持久化走 backbone `persist` 原语。）

**LLM provider 踩坑**（Opus 4.7 temperature / Gemini grounding 与 JSON 互斥 / 模型名 / maxOutputTokens 安全值）见 [docs/gotchas.md](docs/gotchas.md) 末段。

**`Skill.status` 是人工 toggle**（OFFLINE 时 backbone 报 SKILL_OFFLINE，orchestrator 不暴露为 tool）。

## 命名规约（跨层契约）

完整清单见 **[docs/naming-conventions.md](docs/naming-conventions.md)**。硬规则（违反就出错）：

- **Error code 必须从 [`lib/agent-errors.ts`](lib/agent-errors.ts) 的 `AgentErrorCode` enum 取**——TS 类型已收紧，写 raw string tsc 报错；新加 code 必须在 enum + `DIAGNOSTIC_HINTS_ZH` (`lib/agent-errors-i18n.ts`) 同步加项
- **API 错误响应统一格式** `{ ok: false, errorCode, errorMessage, error }`，用 `respondError` / `respondAuthError` / `respondValidationError` 写，不要再 `NextResponse.json({ error })`
- **失败 type 用 `errorCode` 字段不是 `code`**——`SceneError.code` getter 已 deprecated，2026-06 后删
- **API path**：static 段 kebab-case (`dry-run` / `test-invoke`)，dynamic 段 camelCase (`[skillId]`)；第一层 `[id]`，第二层及以下用具名（消歧义）
- **三个 input\* 字段不要统一**：`inputMapping`（v1 legacy）/ `inputFrom`（v2 DAG node）/ `prepareAgentInput`（scene ctx→agent.input）
- **Json 列后缀**：`*Config` / `*Log` / `*Trace` / `*Map` / `*Metadata` / `*Snapshot`——不要起 `*Data` / `*Info`
- **文件命名**：`<verb>.ts` = 公开入口（`invoke.ts` / `dispatch.ts`），`<noun>.ts` = 内部引擎 / registry / types
- **三个不同名的"测试执行" endpoint** 不要重命名（UI 已 hardcode）：skill = `test-invoke` / scene = `sample-run` / agent = `dry-run`
- **2026-05-11 + 2026-05-12 命名收敛**：`SceneError.code → errorCode` / `invokeAgent → executeAgent` / `relic.draft-metadata → relic.generate-draft-metadata` / `equipSlot → slotIndex` / `SceneBinding.inputMap` 退役（改用 `scene.prepareAgentInput`），均带 back-compat 路径

## Prisma db push 与生产迁移范式

仓库**不用 `prisma migrate`**（无 `prisma/migrations/` 目录），所有 schema 同步走 `prisma db push`。`npm start` 串联多步（每个 migrate 脚本都是幂等的）。当前链（pre-push 段处理破坏性变更，post-push 段做数据 backfill 与 forge 配置）：

```
# pre-push: 历史破坏性变更 + skill handler schema
tsx prisma/migrate-token-hash.ts
  && tsx prisma/migrate-agent-loadout.ts
  && tsx prisma/migrate-remove-runtime-config.ts
  && tsx prisma/migrate-remove-classification.ts
  && tsx prisma/migrate-skill-handlers.ts
  && tsx prisma/migrate-skill-kind-rename.ts
  && tsx prisma/migrate-drop-rollout-and-activity.ts
  && tsx prisma/migrate-relic-drafts.ts
  && tsx prisma/migrate-remove-relic-origin-acquired.ts
  && tsx prisma/migrate-drop-internal.ts           # 退役 INTERNAL enum：reassign placeholder 行 → MCP_SERVER，删 picker INTERNAL row + equips，重建 SkillKind enum 不含 INTERNAL
  && tsx prisma/migrate-drop-outputmap.ts          # 退役 SceneBinding.outputMap 列：dump + 校验 5 个 known scene + DROP COLUMN（2026-05-11）
  && tsx prisma/migrate-drop-inputmap.ts           # 退役 SceneBinding.inputMap 列：dump 全部 inputMap + DROP COLUMN（2026-05-12，all-in 把 ctx → agent.input 改成 scene.prepareAgentInput 代码层 own）
  && tsx prisma/migrate-rename-agent-status.ts     # AgentStatus enum ONLINE → DEPLOYED：单条 ALTER TYPE RENAME VALUE（2026-05-15，deploy 闸门成功后 status 置 DEPLOYED）

# schema 同步
  && prisma db push --skip-generate --accept-data-loss

# post-push: 列存在后做数据 backfill / 创建 forge 配置
  && tsx prisma/migrate-skill-slug.ts
  && tsx prisma/migrate-scene-bindings.ts          # SCRIBE capabilities + 默认 binding
  && tsx prisma/migrate-meshy-forge.ts             # seed meshy-3d-http skill (agent owned by migrate-relic-forge,2026-05-12 合并；save-asset-relic 2026-05-13 退役→persist 原语)
  && tsx prisma/migrate-cutout-forge.ts            # seed fal-cutout-http skill (agent + save-asset-enhanced 已退役,2026-05-12)
  && tsx prisma/migrate-phase5-cleanup.ts          # 删 SCRIBE 旧 DAG/equip + 历史 outputMap seed（已剥离）
  && tsx prisma/migrate-lore-forge.ts              # seed 3 个 gemini-* skill (agent owned by migrate-relic-forge,2026-05-12 合并)
  && tsx prisma/migrate-phase6-cleanup.ts          # 清 SCRIBE pipelineConfig + equips + 删 relic-gemini-researcher Skill
  && tsx prisma/migrate-cleanup-io-primitives.ts   # 删历史 IO primitive Skill row
  && tsx prisma/migrate-shared-network-skills.ts   # seed 共享 download-network-image skill (LENS / 未来其他 forge 共用)
  && tsx prisma/migrate-picker-removal.ts          # 永久退役 PICKER-FORGE-001：删 SceneBinding(smart-image-pick) + agent + serp-image-search/vision-compare-candidates 两个独占 skill。idempotent。详见 prisma/migrate-picker-forge.ts 头注释（2026-05-14）
  && tsx prisma/migrate-lens-forge.ts              # 2 skill (lens-reverse-search + vision-similarity-score) + LENS-FORGE-001 + 绑 relic.network-image-search (forEach DAG)；复用 migrate-shared-network-skills 建的 download-network-image
  && tsx prisma/migrate-rename-scene-keys.ts       # SceneBinding.sceneKey 改名: relic.draft-metadata → relic.generate-draft-metadata（含 alias 兜底）
  && tsx prisma/migrate-rename-equipslot.ts        # Agent.pipelineConfig JSON 内 equipSlot → slotIndex 字段重命名（idempotent，递归 loop/forEach body）
  && tsx prisma/migrate-relic-forge.ts             # 合并 3 forge → RELIC-FORGE-001 (4-way mode branch, 5 slots; slot 5 空 — persist 原语) + 重绑 4 个 relic.* scene + 删 save-asset-enhanced + save-asset-relic（2026-05-12 / 2026-05-13）
  && tsx prisma/migrate-replace-save-asset.ts      # 兜底：重写自定义 agent pipelineConfig 把 save-asset-relic/save-network-asset skill 节点替换为 persist 原语；清理 equip + skill 行（idempotent）
  && next start
```

**遇到"data loss"拒绝时不要直接加 `--accept-data-loss` 了事** —— `db push` 不带这个 flag 拒绝执行的两类操作（删列、把可空列改 NOT NULL 但仍有 NULL 行），都应该先在一个一次性 `prisma/migrate-*.ts` 脚本里手工处理，让 db push 真正变成无害 diff。范本：

- [`prisma/migrate-token-hash.ts`](prisma/migrate-token-hash.ts) —— bcrypt 重哈希 + 删老 `User.token` 列（pre-push）
- [`prisma/migrate-agent-loadout.ts`](prisma/migrate-agent-loadout.ts) —— drop 6 老 stat 列 + backfill 空 `Agent.avatarUrl`（pre-push）
- [`prisma/migrate-remove-runtime-config.ts`](prisma/migrate-remove-runtime-config.ts) —— drop 10 个 Agent runtime 列 + drop `AgentProvider` enum（pre-push）
- [`prisma/migrate-meshy-forge.ts`](prisma/migrate-meshy-forge.ts) / [`migrate-cutout-forge.ts`](prisma/migrate-cutout-forge.ts) / [`migrate-lore-forge.ts`](prisma/migrate-lore-forge.ts) / [`migrate-relic-forge.ts`](prisma/migrate-relic-forge.ts) —— 前三只 seed skill，后者建 RELIC-FORGE-001 agent + 6 equips + 重绑 4 scene + 删旧 forge agents（post-push，复用 Prisma client）

模式：用 `information_schema` 检查列存在 → 存在则 `ALTER TABLE ... DROP COLUMN IF EXISTS` 或 `UPDATE ... SET ... WHERE ... IS NULL`。**幂等**——重跑无副作用。新加破坏性 schema 改动时复制一个新 migrate 脚本接到 npm start 链上。`--accept-data-loss` 只作兜底，不作主路径。

## 设计约定 / 工具踩坑

排版、Tailwind/Prisma/Next 工具行为、CyberPanel 高度链、API 错误脱敏、组件交互模式、i18n 模板语法、静态资源 + middleware 鉴权陷阱、LLM provider 踩坑等所有**已固化的踩坑结论**整理到 **[docs/gotchas.md](docs/gotchas.md)**。遇到诡异现象先 `Cmd+F` 查那里。

- **写后必跑 `router.refresh()`**：App Router 不会自动失效服务端数据。
- **隐藏功能**：HeroPortrait 暗藏 SecretDoor（桌面 10 次连点 / 移动端长按 10 秒解锁 `/vault`）。**禁止**在 UI 加任何提示。
- **静态图必须放 `/public/images/...`**：middleware 默认拦截所有路径，`next/image` 优化器 SSR fetch 不带 cookie，否则被重定向到 /login。
- **学习 DAG 怎么搭** —— [docs/canonical-dags/](docs/canonical-dags/) 下 3 个最小示例 (`01-single-skill` / `02-branch-flow` / `03-foreach-pick`) 配 `.agent.json` envelope，admin 可直接通过 `/agent-control` import 试玩。命名规范 (node id / 字段名) 也在 README。
- **出问题怎么定位** —— [docs/smoke-checklist.md](docs/smoke-checklist.md) 是 8 步冒烟清单，每步给短路检查点 (skill test-invoke / scene sample-run / agent dry-run) + "断了看哪里"对应表。

## Commit 规范

`feat(personal-web): ...` / `fix(personal-web): ...`（遵循顶层工作簿约定）。

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

无测试套件；改动需自行 `npm run type-check && npm run lint && npm run build` 验证。

## 架构要点（跨文件理解）

**鉴权链路** —— 三段串联，改任一段都需联动：
1. `middleware.ts`：全局闸门。**项目硬规约：所有路由默认要求登录**。公开白名单只允许 exact match：`/login`、`/api/auth/login`、`/api/locale`、`/sacred-terms`、`/privacy-covenant`、`/favicon.ico`。`PUBLIC_PREFIXES` 必须保持空数组——绝不再引入通配前缀（曾出过 `/relic-collection` 与 `/api/relics` 被整段公开的事故）。新增需要公开的路由先与用户确认，再仅以 exact match 加入 `PUBLIC_PATHS`。② 校验 `gd_session` cookie 存在；③ 对 `/api/*` 的 POST/PUT/PATCH/DELETE 做 CSRF 校验（`Origin`/`Referer` 主机匹配 host 才放行）。Edge runtime 不能 import Prisma，DB session 过期判定只能在下层做。
2. `lib/auth.ts`：暴露 `requireUser()` / `requireAdmin()`，所有写操作 API route 必须经过它。管理员判定 = `user.level >= ADMIN_LEVEL`（=100），**没有** `ADMIN_TOKEN` 环境变量，纯靠 DB 中的 level 字段。续期失败已 try/catch 记日志（不再静默吞）。
3. 登录流：POST `/api/auth/login` 传用户 token → 创建 Session 行 → 写 `gd_session` HttpOnly cookie。Session 7 天有效，支持滑动续期。**速率限制**：每 IP 60 秒内 5 次失败后返回 429，模式抄自 `app/api/vault/unseal/route.ts`。

**i18n 边界** —— Server Component 用 `lib/i18n/server.ts`，Client Component 用 `lib/i18n/client.tsx`，**两者不可混用**。语言偏好存 `locale` cookie，由 `/api/locale` 切换；字典在 `lib/i18n/dictionaries/{en,zh}/`。

**数据模型**（详见 `prisma/schema.prisma`）：
- `User` —— 含 RPG 属性字段（level/attack/defense/hp/agility/luck/specialAttributes），`SkillsRadar` 组件读这些字段渲染。
- `Activity` —— 用户动态，正文 ≤ 280 字符（`lib/validators.ts` 强制），关联 `User`。POST 接口对最近 5 秒内同 `userId+content` 自动去重（幂等），前端不要假定每次 POST 都新建。
- `Session` —— 登录会话。
- `Agent` —— `/machine-agent` 模块的 workflow / agent 实体，关键字段：`mode`（`MECHANICAL` 黄色 / `AUTONOMOUS` 青绿）、`avatarUrl` **NOT NULL**、4 项派生 stats（`chaosLevel/costTier/activityLevel/stabilityLevel`，本期都 0% 占位）、`pipelineConfig` Json?（machine 中央槽 workflow 调度）、`dispatcherConfig` Json?（agent 中央槽 orchestrator 调度）、`deployedAt`（草稿 vs 已部署）。详见下方"Machine & Agent 装备界面"段。
- `Skill` —— 可装备的能力定义（kind = PASSIVE/ACTIVE/ULTIMATE，level 1-6，icon 走 Material Symbols 名）。CRUD 在 `/machine-agent?tab=skills`。
- `AgentSkillEquip` —— Agent ↔ Skill 多对多桥表，关键字段：`slotIndex` Int? (0..5) 标记装备到脊柱/大脑哪个槽；`unlocked` 锁/解锁标志。同一 agent 同一 slot 唯一性由 API 事务保证（`db push` 不支持 partial unique index）。

**Prisma client** —— 通过 `lib/db.ts` 单例导出，避免开发热重载时连接泄漏。`postinstall` 自动 `prisma generate`。

## 路由速览

```
app/
  login/                — token 登录页
  admin/users/          — 管理员用户管理
  profile/              — 当前用户主页
  machine-agent/        — Agent / Skill 装备界面（tab=agents 默认 / tab=skills 库 CRUD）
  api/
    auth/{login,logout,me}
    users/[id]          — GET / PATCH / DELETE（写需 admin）
    activities/[id]     — GET / DELETE
    profile/            — PATCH 更新 bio
    locale/             — POST 切换语言
    agents/             — GET / POST，[id] PATCH/DELETE，[id]/skills POST/[skillId] PATCH-DELETE，
                          [id]/{pipeline,dispatcher} PUT，[id]/deploy POST
    skills/             — GET / POST，[id] PATCH / DELETE
```

## 环境变量

复制 `.env.example` → `.env`（已在 `.gitignore`，**禁止 commit**）。最小集合：

```bash
DATABASE_URL="postgresql://gd_dev:gd_dev_local@localhost:5432/green_diva?schema=public"
ADMIN_TOKEN="..."             # seed 初始 admin token
SAFETY_SECRET="..."     # ≥32 字节，openssl rand -base64 32（详细影响范围见下方运维约定段）
SECRET_DOOR_PASSWORD=""       # /vault 暗门 UI 输入的明文密码（与 SAFETY_SECRET 是两个独立 env，协作完成"密码 → 签 cookie"）
# ALLOW_PROD_SEED=1           # 生产环境强行运行 seed 才需要
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

## Machine & Agent 装备界面（`/machine-agent`）

赛博朋克 2077 风格的装备面板，承载站内所有 AI workflow（machine，黄色）和 AI agent（agent，青绿）。"ai-clergy" 是已废弃的旧名，**不要再创建 `/ai-clergy` 路由**——所有迭代统一在 `/machine-agent` 下。

**单屏布局** —— ≥1024px 桌面端 100vh **不出现外部滚动条**，左 `lg:col-span-3` roster + 右 `lg:col-span-9` 详情区。详情区 5 块垂直堆叠：DetailHeader → BaseStatsBar（4 条 0% 进度条）→ EquipmentLoadout（核心，`flex-1 min-h-0`）→ ControlConfigStrip → DeployButton。布局骨架在 [`AgentClient.tsx`](app/machine-agent/AgentClient.tsx)。

**槽位** —— 每个 Agent 6 个 skill 槽 + 1 个中央 CONTROL 槽，绝对定位 + 百分比坐标，常量集中在 [`lib/machineAgent/slotPositions.ts`](lib/machineAgent/slotPositions.ts)：
- machine（脊柱）—— 三对左右对称排列；背景 `/public/machine-agent/spine.jpg`，缺图自动 fallback `spine.svg`。
- agent（大脑）—— 圆弧排列 6 点；背景 `/public/machine-agent/brain.jpg`，缺图 fallback `brain.svg`。
- 未来要基于上传图切割自动调对齐时只改这一个文件，签名预留 `getLoadoutLayout(mode)`。

**⚠️ 中央 CONTROL 槽不是 skill** —— 它存的是"如何调度 6 个 skill 协作运行"的配置：
- machine 中央 = `Agent.pipelineConfig` Json（workflow 节点 / 连线 / 参数）
- agent 中央 = `Agent.dispatcherConfig` Json（AI Orchestrator 调度策略 / 模型 / prompt）

数据上是 Json 字段，**不是 skillId 外键**。UI 上中央槽点击弹 [`ControlConfigModal`](app/machine-agent/components/ControlConfigModal.tsx)（JSON textarea 占位 + 标"待开发"），不是 SkillPicker。SkillLibrary CRUD（`tab=skills`）只管 skill 自身能力定义，与中央槽互不重叠。改这块务必保持边界。

**派生 stats 占位** —— `chaosLevel / costTier / activityLevel / stabilityLevel` 当前都返回 0%，UI 显示"⏳ pending derivation"。未来算法落在 `lib/agents/derived.ts`（TODO），输入是 AgentSkillEquip + 调用历史。语义：
- chaos = 跨 mode 装配的"赛博精神病"指数（如 machine 装满 agent 类 skill）
- cost = 外部 API 累计花费等级
- activity = 滑窗内调用次数
- stability = 调用成功率

**调用层（invoke）尚未实现** —— [`lib/agents/invoke.ts`](lib/agents/invoke.ts) 只是函数签名 + `throw "NOT_IMPLEMENTED"`。Deploy 按钮当前**只更新 `deployedAt` 时间戳**，不真正注册可调用能力。其他模块**不要**在生产路径里调 `invokeAgent`，会立即抛错。

**主色绑定 mode** —— machine = `secondary` (#e9c176 金黄)，agent = `primary` (#90decd 青绿)。新 UI 子组件接 `agent.mode` 切两套配色，不要硬编码颜色。

## Prisma db push 与生产迁移范式

仓库**不用 `prisma migrate`**（无 `prisma/migrations/` 目录），所有 schema 同步走 `prisma db push`。`npm start` 串联三步：

```
tsx prisma/migrate-token-hash.ts && tsx prisma/migrate-agent-loadout.ts && prisma db push --skip-generate --accept-data-loss && next start
```

**遇到"data loss"拒绝时不要直接加 `--accept-data-loss` 了事** —— `db push` 不带这个 flag 拒绝执行的两类操作（删列、把可空列改 NOT NULL 但仍有 NULL 行），都应该先在一个一次性 `prisma/migrate-*.ts` 脚本里手工处理，让 db push 真正变成无害 diff。范本两个：
- [`prisma/migrate-token-hash.ts`](prisma/migrate-token-hash.ts) —— bcrypt 重哈希 + 删老 `User.token` 列
- [`prisma/migrate-agent-loadout.ts`](prisma/migrate-agent-loadout.ts) —— drop 6 老 stat 列 + backfill 空 `Agent.avatarUrl`

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
- **`CyberPanel` 内部包了一层 `<div className="relative z-10 h-full">`** —— 这意味着直接给 `CyberPanel` 加 `flex flex-col min-h-0` className **对子节点无效**（children 的真实父是那层 block div 不是 flex）。新建 5 块垂直布局时务必在 children 外再包一层 `<div className="flex flex-col h-full gap-3 min-h-0">`，否则 `flex-1` / `shrink-0` 全部失效，子区域会被挤成 0 高度。范本 [`AgentClient.tsx`](app/machine-agent/AgentClient.tsx) 详情区。
- **背景图绝对定位 + 槽位百分比坐标**：用 `relative aspect-[3/4]` + `next/image fill object-contain` + 子节点 `absolute -translate-x-1/2 -translate-y-1/2` + 顶层 `top/left` 百分比常量。背景图缺失时给 `<Image onError>` 切到同名 SVG fallback（避免 layout 因 404 崩塌）。范本 [`EquipmentLoadout.tsx`](app/machine-agent/components/EquipmentLoadout.tsx)。

### Prisma 写入陷阱
- **可空 Json 字段写 `null` 必须用 `Prisma.JsonNull`** —— `data: { pipelineConfig: null }` 类型报错。正确写法：`pipelineConfig: parsed.config === null ? Prisma.JsonNull : (parsed.config as Prisma.InputJsonValue)`。范本 [`app/api/agents/[id]/pipeline/route.ts`](app/api/agents/[id]/pipeline/route.ts)。
- **Partial unique index 不能写在 schema** —— Prisma `@@unique([a, b])` 不支持 `WHERE` 过滤。`AgentSkillEquip` 的"同 agent 同 slotIndex 唯一"靠 API 事务里 `deleteMany({ where: { agentId, slotIndex } })` 先清后插实现，schema 里只放普通 `@@index`。

### 开发缓存（绝对避免）
- **dev 服务器跑着的时候不要跑 `npm run build`** —— production build 写 `.next/` 会覆盖 dev 引用的 chunk 文件，dev 立即报 `Cannot find module '../chunks/ssr/[turbopack]_runtime.js'` 然后整页白屏。恢复需要 `preview_stop` → `rm -rf .next .next-dev` → 重启 dev 进程。验证用 `type-check` + `lint` 即可，build 等所有改动 stable 后单独跑。

### 组件交互模式
- **写后必跑 `router.refresh()`**：POST/PATCH/DELETE 完成后客户端调 `router.refresh()` 重拉服务端数据，App Router 不会自动失效。落地范本：[LanguageSwitcher](components/LanguageSwitcher.tsx)、[BioEditor](app/profile/BioEditor.tsx)、[ActivityList](app/profile/ActivityList.tsx)、[UsersTable](app/admin/users/UsersTable.tsx)。
- **下拉菜单**：`useRef + onMouseDown 监听 document + ESC 键`（参考 [UserMenu.tsx](components/UserMenu.tsx)）。新做 dropdown 沿用，不要自己造。
- **全屏抽屉/模态**：`createPortal(...,  document.body)` + `body.style.overflow = "hidden"` + ESC 关闭（参考 [MobileNav.tsx](components/MobileNav.tsx)）。新模态沿用 portal 模式避免 z-index 战争。
- **不可逆操作确认**：用浏览器原生 `confirm()` + `format(t.x.confirm, { name })` 模板（参考 [UsersTable.tsx](app/admin/users/UsersTable.tsx) 删除流程），不要自己造确认弹窗。
- **倒计时 / 时间相关组件**：渲染含 `Date.now()` 的内容必须套 `suppressHydrationWarning`（服务端渲染时间戳和客户端初次渲染必然不一致）。参考 [DescentCountdown.tsx](components/DescentCountdown.tsx)。

### i18n 调试 & 模板语法
- `getDictionary()` 无缓存，HMR 即时生效。文字"没改掉"99% 是浏览器强缓存 / 改错语言文件 / 文本含 `##...##` `**...**` `__...__` 被 hero 解析为高亮（[app/page.tsx](app/page.tsx) `originBody` 渲染逻辑），不是 SSR 锁。
- **模板占位符**：`format(template, vars)` 用 **双大括号** `{{name}}`，见 [lib/i18n/format.ts](lib/i18n/format.ts)。新模板字符串遵循。
- **Hero 文本专属 markup**（**仅 `originBody` 解析**）：`##...##` → 大号 `text-secondary` + `sacred-glow`；`**...**` → 中等强调 `text-secondary`；`__...__` → 强调 + glow。其他页面文字不会被解析，照搬 markup 不会变样式。

### 资源与性能
- **远程头像**：`avatarUrl` 是任意外部 host，**未在 `next.config.ts` 配置 `images.remotePatterns` 前不要换 `next/image`**（会运行时崩）。需要懒加载用 `<img loading="lazy" decoding="async">`。
- **视频组件**：`SeamlessLoopVideo` 自动检测 `navigator.connection.saveData` / `effectiveType in {slow-2g, 2g, 3g}` / `prefers-reduced-motion`，命中即退化为静态 `<div>`（背景图 / 纯色）。新做循环视频组件沿用此模式，不要直接用 `<video autoPlay>`。HMR 中间态偶尔短暂走错分支，验证时硬刷新。

### 隐藏功能（产品意图）
- HeroPortrait 暗藏 SecretDoor：桌面 **10 次连点** 或移动端 **长按 10 秒** 解锁通向 `/vault`。**禁止**在 UI 加任何提示文字、图标或动画暗示。改 [HeroPortrait.tsx](components/HeroPortrait.tsx) / [SecretDoor.tsx](components/SecretDoor.tsx) 时保留低调。

## Commit 规范

`feat(personal-web): ...` / `fix(personal-web): ...`（遵循顶层工作簿约定）。

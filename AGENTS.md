# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Green Diva Homepage —— Next.js 16 App Router 社区平台，Prisma + SQLite（本地）/ Postgres（生产），Tailwind v4，中英文 i18n。

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

**Prisma client** —— 通过 `lib/db.ts` 单例导出，避免开发热重载时连接泄漏。`postinstall` 自动 `prisma generate`。

## 路由速览

```
app/
  login/                — token 登录页
  admin/users/          — 管理员用户管理
  profile/              — 当前用户主页
  api/
    auth/{login,logout,me}
    users/[id]          — GET / PATCH / DELETE（写需 admin）
    activities/[id]     — GET / DELETE
    profile/            — PATCH 更新 bio
    locale/             — POST 切换语言
```

## 环境变量

复制 `.env.example` → `.env`（已在 `.gitignore`，**禁止 commit**）。最小集合：

```bash
DATABASE_URL="postgresql://gd_dev:gd_dev_local@localhost:5432/green_diva?schema=public"
ADMIN_TOKEN="..."             # seed 初始 admin token
SAFETY_SECRET="..."     # ≥32 字节，openssl rand -base64 32（详细影响范围见下方运维约定段）
SECRET_DOOR_PASSWORD=""       # /vault 暗门 UI 输入的明文密码（与 SAFETY_SECRET 是两个独立 env，协作完成"密码 → 签 cookie"）
# ALLOW_PROD_SEED=1           # 生产环境强行运行 seed 才需要

# AI agent capabilities — 缺 KEY 对应 pipeline step graceful skip，不阻塞整条流程
ANTHROPIC_API_KEY=""          # DIVA-001 的 structured-naming / write-lore + relic 自动命名
REMOVE_BG_API_KEY=""          # DIVA-001 抠图（remove.bg）
TAVILY_API_KEY=""             # DIVA-001 联网检索（Tavily）
MESHY_API_KEY=""              # DIVA-001 image-to-3d（Meshy）
AGENT_SECRETS_KEK=""          # 可选，独立加密 KEK；不设则 fallback 到 SAFETY_SECRET
```

> 上面 4 个 API key 也可以通过 admin UI（机器之眼 → capability 卡片"配置 · KEY"按钮）加密录入到 `AgentSecret` 表，运行时 **DB > .env 优先**。详见下方"AI Agent / Pipeline 子系统"段。

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
- **`SAFETY_SECRET`** 是 server-side 安全 root，**5 处直接读取 / 4 大功能用途**：① [`lib/userToken.ts`](lib/userToken.ts) HMAC 派生 `tokenLookup`（O(1) 登录查表）；② [`lib/vault-token.ts`](lib/vault-token.ts) + [`middleware.ts`](middleware.ts) 签 / 验 `gd_vault` cookie（暗门会话）；③ [`lib/relicCookie.ts`](lib/relicCookie.ts) 签 `gd_relic_unlocks` cookie；④ [`lib/agentSecrets.ts`](lib/agentSecrets.ts) SHA-256 派生 AES-256-GCM KEK，加密 admin 录入的 capability API key（domain prefix `"agent-secret-v1\0"` 隔离用法，与 ①②③ 的 HMAC 输出永不碰撞）。**生产必填且 ≥32 字节**（`openssl rand -base64 32`）。轮换它会让以上**全部**失效（用户重登录 / 重 unseal vault / 重录 API key），但**用户的 vault master password 与此完全无关**——`VaultItem` 是客户端 E2E 加密，server 没有解密能力。如需让 API key 加密与登录态解耦轮换，单独设 `AGENT_SECRETS_KEK`（不设则 fallback 到此 secret，零配置维持现状）。
- **未来加密码**：当前 `User.token` 是 random bytes 不可逆，安全。如未来引入密码字段，**必须** bcrypt（cost ≥12）或 argon2id 哈希后入库，**绝不存明文或可逆加密**。
- **`prisma db seed` 在生产被拒绝**：[prisma/seed.ts](prisma/seed.ts) 已加 `NODE_ENV === "production"` 守卫，需要 `ALLOW_PROD_SEED=1` 才能强行跑。仅在初始化新环境时使用。

## AI Agent / Pipeline 子系统（machine-vision + relic pipeline）

跨 `lib/agents/`、`lib/relics/pipeline/`、`lib/agentSecrets.ts`、`/api/relics/draft|job|jobs/[jobId]/retry`、`/api/admin/agent-secrets`、`app/machine-vision/` 协作的子系统。改任一处都要读完本段，否则容易踩 5 类陷阱。

### 数据模型扩展（详见 `prisma/schema.prisma`）

- `Agent` —— machine-vision 的"代理圣徒"。`skills` JSON 字段是 `AgentSkill[]`（**展示型**：icon/level 1-6/unlocked，UI 装饰），与下面"capability"是**两层**，不要互相覆盖。
- `AgentInvocation` —— agent 工作流水（machine-vision 调用台 + capability `withInvocationLogging` wrapper 都写）。
- `AgentSecret` —— admin 通过 UI 加密录入的 API key 行，AES-256-GCM 加密；`hint` 是末 4 字符 mask；**永不**返回 ciphertext / 明文给客户端。
- `Relic` 加 `status: RelicStatus`（`DRAFT/PROCESSING/READY/PARTIAL/FAILED`，默认 READY 兼容存量）+ `draftNote`（用户提交的描述）+ `jobs[]`。
- `RelicProcessingJob` —— 单次 pipeline 跑的状态机：`status / step / progress(0-100) / attempt / maxAttempts / meshyTaskId / errorMessage / stepResults(Json)`。
- `RelicAction` enum 加 4 个 `PROCESSING_*`，自动出现在 relic 详情页活动日志时间线（i18n key 已加，UI 不用改）。

### 陷阱 1：`AgentSkill` vs `AgentCapability` 命名冲突 ⚠️

- [`lib/agentTypes.ts::AgentSkill`](lib/agentTypes.ts) —— **展示型**（icon/nameEn/level/costAp/unlocked），机器之眼 SKILL PROGRESSION 渲染用，**不可执行**。
- [`lib/agents/types.ts::AgentCapability<I, O>`](lib/agents/types.ts) —— **可执行**接口（`run(agent, input)`），物理上归属具体 agent，目录 `lib/agents/<codename>/`（当前只有 `diva-001/`）。
- **首要陷阱**：grep / 写代码时千万别混。client 组件需要 capability 类型时，**必须**从 [`lib/agents/capabilityTypes.ts`](lib/agents/capabilityTypes.ts) import（无 `server-only` 守卫的纯类型文件），**不要**从 `lib/agents/types.ts`（有 `server-only`，client 打包会炸）。

### 陷阱 2：API key 必须 `await getSecretOrEnv(name)`

外部 API key（ANTHROPIC / REMOVE_BG / TAVILY / MESHY）**绝不直接** `process.env.X` 读：
- 优先级 **DB > .env**（admin 通过 UI 录入加密存 `AgentSecret` 表，运行时即时生效，无需重启 server）
- Capability 内部 + pipeline step graceful skip 检查统一 `const key = await getSecretOrEnv("X")`（async！），缺则 throw / skip
- 加新 capability / 改既有 capability 时跟随这个模式
- 通用 [`invokeAgent`](lib/agents/invoke.ts) + `/api/agents/[id]/invoke` 仍保留给"调用台手动玩 agent"，**capability 不走它**（capability 是确定性多步流程，不是单次 LLM tool-call）

### 陷阱 3：Relic Pipeline runner 约束

- 7 step 串行：`EXTRACT_ZIP → REMOVE_BG → STRUCTURED_FIELDS → GEN_3D → WEB_RESEARCH → WRITE_LORE → PACK_DERIVED`
- **Fire-and-forget**：`/api/relics/draft` 创建 Job 后 `void runRelicPipeline(jobId)` 立即返回 201，**绝不 await**
- **顶层永不 throw**：`runRelicPipeline` 顶层 `try/catch` 把任何错误写到 `Job.errorMessage` + `status=FAILED`；throw 会变 unhandled rejection
- **Graceful skip**：缺 KEY / 单 step 内部失败 → `return { ok: true, data: { status: "skipped", reason } }`，pipeline 不整体崩；最终 `Relic.status` 视产物完整度落 `READY` / `PARTIAL`
- **自动重试**：runner 对瞬时错误（5xx / timeout / ECONN / EAI_AGAIN / "fetch failed"）退避（`2^attempt * 1s`）至 `Job.maxAttempts=3`
- **续跑**：`POST /api/relics/[id]/jobs/[jobId]/retry?fromStep=GEN_3D` 从指定 step 续跑；上游 step 结果从 `Job.stepResults` JSON 还原（无需重跑）
- **Crash recovery**：[`lib/server-init.ts::ensureServerInit()`](lib/server-init.ts) 在 `/api/relics/draft` + `/api/relics/[id]/job` 入口懒触发，重启 `RUNNING & updatedAt < 10min ago` 的 job。**新加 job-creating endpoint 时也要调** `await ensureServerInit()`
- **文件布局**：`private/relics/{slug}/{source/{archive-{ts}.zip, extracted/}, derived/}`；`Relic.derivedArchivePath` 是最终归档 ZIP（详情页"下载归档资料包"按钮自动 enabled）

### 加新 capability 的标准流程

1. 在 `lib/agents/<codename>/<id>.ts` 实现 `AgentCapability<I, O>`；**必须**填 `metadata: { iconKey, nameEn/Zh, descriptionEn/Zh, provider, requiredEnvVars }`（machine-vision UI 直接读 metadata 渲染卡片）
2. 用 `withInvocationLogging(baseCap)` 包一层 → 自动写 `AgentInvocation`（`source = "capability:<id>"`，UI 调用台流水自动反映）
3. 在 `<codename>/index.ts` 注册到 capability map；[`lib/agents/registry.ts`](lib/agents/registry.ts) 把 codename 加到 `REGISTRY` 即可
4. 自动获得：machine-vision UI 列出该能力 + admin 看到"配置 · ENV_NAME"按钮 + capability 状态点联动 SKILL PROGRESSION rail + summary 流水统计
5. 如新 capability 需要 KEY，UI 配置入口**自动出现**——不用单独写（`lib/agents/knownSecrets.ts` 从所有 capability 的 `metadata.requiredEnvVars` 自动派生白名单）

### UI 模式

- **进度展示** = **3 秒 setInterval 轮询**（参考 [`RelicProcessingBanner.tsx`](app/relic-collection/[slug]/_components/RelicProcessingBanner.tsx)），完成后 `router.refresh()`。**不要**上 SSE / WebSocket，除非有 100ms 级实时性需求
- **加密 KEY 录入** = capability 卡片"配置 · ENV_NAME"按钮 → 弹 [`SecretDialog`](app/machine-vision/components/SecretDialog.tsx)（password input + POST `/api/admin/agent-secrets`）；已配置时显示"重设 / 清除"。这些 UI 用 `isAdmin` 控制可见，非 admin 看到的是只读"需配置"徽章
- **Rail ↔ List 联动** = [`CapabilityPair`](app/machine-vision/AgentClient.tsx) 子组件持有 `activeCapId` state + `key={agent.id}` 让切换 agent 时 React 自动 remount + lazy `useState` init 选首个 envOk capability。**这是规避 React 19 set-state-in-effect lint rule 的范本**，新加联动两件套时沿用

### 简化的添加 Relic 流程（替代 RelicForm）

- [`RelicDraftPanel`](app/relic-collection/_components/RelicDraftPanel.tsx) 仅 2 输入：ZIP + 描述。POST `/api/relics/draft` → 自动跳详情页 → banner 展示 pipeline 进度
- 旧 [`RelicForm`](app/admin/relics/RelicForm.tsx) 仅作"编修"用（admin 改字段），不再走"新建"路径
- VaultCell 在 `relic.status === "PROCESSING" / "DRAFT"` 时显示右下 `progress_activity` 旋转图标
- Slot 范围按 schema 实际（60 槽位 / 2 页），不是旧 RelicForm 误写的 1-30

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

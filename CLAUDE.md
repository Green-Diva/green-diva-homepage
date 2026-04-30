# CLAUDE.md

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
1. `middleware.ts`：全局闸门。① 公开路由白名单（`/login`、`/api/auth/login`、`/api/locale`、`/sacred-terms`、`/privacy-covenant`、`/favicon.ico`），新增公开页需在这里放行；② 校验 `gd_session` cookie 存在；③ 对 `/api/*` 的 POST/PUT/PATCH/DELETE 做 CSRF 校验（`Origin`/`Referer` 主机匹配 host 才放行）。Edge runtime 不能 import Prisma，DB session 过期判定只能在下层做。
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
VAULT_COOKIE_SECRET="..."     # ≥32 字节，openssl rand -base64 32
SECRET_DOOR_PASSWORD=""       # 可选，/vault 暗门
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
- **`VAULT_COOKIE_SECRET`**：生产必填且 ≥32 字节。用 `openssl rand -base64 32` 生成；轮换时所有当前 vault cookie 立即失效。
- **未来加密码**：当前 `User.token` 是 random bytes 不可逆，安全。如未来引入密码字段，**必须** bcrypt（cost ≥12）或 argon2id 哈希后入库，**绝不存明文或可逆加密**。
- **`prisma db seed` 在生产被拒绝**：[prisma/seed.ts](prisma/seed.ts) 已加 `NODE_ENV === "production"` 守卫，需要 `ALLOW_PROD_SEED=1` 才能强行跑。仅在初始化新环境时使用。

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

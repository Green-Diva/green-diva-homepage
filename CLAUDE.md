# CLAUDE.md — Green Diva Homepage

Next.js 16 App Router 社区平台，Prisma + SQLite（本地）/ Postgres（生产），Tailwind v4，支持中英文 i18n。

## 常用命令

```bash
npm run dev          # 开发
npm run build        # 生产构建
npm start            # 启动生产
npm run lint         # ESLint 检查
npm run db:push      # 同步 schema 到 DB
npm run db:seed      # 重置示例数据
```

## 目录结构

```
app/
  login/             — 登录页（token 输入）
  admin/users/       — 管理员用户管理（列表 / 新建 / 编辑）
  profile/           — 当前用户个人主页（bio、动态、token 查看）
  api/
    auth/login       — POST 登录（token 换 session）
    auth/logout      — POST 登出
    auth/me          — GET 当前用户
    users/           — GET 列表 / POST 新建（需管理员）
    users/[id]       — GET / PATCH / DELETE（写操作需管理员）
    activities/      — GET 列表 / POST 发布动态
    activities/[id]  — GET / DELETE
    profile/         — PATCH 更新个人简介
    locale/          — POST 切换语言
components/
  admin/UserForm.tsx — 用户新建/编辑表单（复用）
  HeroPortrait.tsx   — 首页头像展示
  LanguageSwitcher.tsx — 语言切换按钮
  MobileNav.tsx      — 移动端导航
  SkillsRadar.tsx    — RPG 属性雷达图
  UserMenu.tsx       — 顶部用户菜单
lib/
  auth.ts            — session 鉴权、requireUser/requireAdmin
  db.ts              — Prisma 单例
  validators.ts      — Zod schema
  i18n/              — 国际化（en / zh 字典 + server/client 工具）
prisma/
  schema.prisma      — 数据模型（User / Activity / Session）
  seed.ts            — 示例数据
middleware.ts        — 全局 session 校验，未登录重定向 /login
```

## 数据模型

- **User** — `id / serial / token / name / gender / avatarUrl / bio / level / attack / defense / hp / agility / luck / specialAttributes`
- **Activity** — 用户动态，最多 280 字符，关联 User
- **Session** — 登录会话，7 天有效，支持滑动续期

## 鉴权机制

- 登录：POST `/api/auth/login` 传 `token`（即用户的个人 token），服务端创建 Session 并写 `gd_session` HttpOnly Cookie
- 中间件：每个非公开路由检查 `gd_session` cookie，未登录重定向 `/login` 或返回 401
- **管理员**：`user.level >= 100`（`ADMIN_LEVEL = 100`），由 `lib/auth.ts` 中 `requireAdmin()` 强制校验
- 公开路由：`/login`、`/api/auth/login`、`/favicon.ico`

## i18n

支持中文（`zh`）和英文（`en`），字典位于 `lib/i18n/dictionaries/`。语言偏好通过 `locale` cookie 存储，`/api/locale` 负责切换。Server Component 用 `lib/i18n/server.ts`，Client Component 用 `lib/i18n/client.tsx`。

## 环境变量

```bash
DATABASE_URL="file:./prisma/dev.db"   # SQLite（本地）或 Postgres 连接串
```

> 无需 `ADMIN_TOKEN`，管理员身份由数据库中 `user.level` 决定。

## Commit 规范

`feat(personal-web): ...` / `fix(personal-web): ...`（遵循顶层工作簿约定）。

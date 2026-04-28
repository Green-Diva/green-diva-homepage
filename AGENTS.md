# AGENTS.md

本文件为面向 AI 编码代理的协作指南，与 `CLAUDE.md` 保持同步。

Green Diva Homepage —— Next.js 16 App Router 社区平台，Prisma + SQLite（本地）/ Postgres（生产），Tailwind v4，中英文 i18n。

> `CLAUDE.md` 与本文件保持一致。修改其一时请同步另一个，避免漂移。

## 常用命令

```bash
npm run dev          # 开发
npm run build        # 生产构建
npm start            # 启动生产
npm run lint         # ESLint
npm run db:push      # 同步 schema 到 DB（首次或改 schema 后）
npm run db:seed      # 重置示例数据（会清表）
npx prisma generate  # 手动重新生成 client（postinstall 已自动执行）
```

无测试套件；改动需自行 `npm run lint` + `npm run build` 验证。

## 架构要点（跨文件理解）

**鉴权链路** —— 三段串联，改任一段都需联动：
1. `middleware.ts`：全局闸门，校验 `gd_session` cookie。公开路由白名单写死在此（`/login`、`/api/auth/login`、`/favicon.ico`），新增公开页需在这里放行。
2. `lib/auth.ts`：暴露 `requireUser()` / `requireAdmin()`，所有写操作 API route 必须经过它。管理员判定 = `user.level >= ADMIN_LEVEL`（=100），**没有** `ADMIN_TOKEN` 环境变量，纯靠 DB 中的 level 字段。
3. 登录流：POST `/api/auth/login` 传用户 token → 创建 Session 行 → 写 `gd_session` HttpOnly cookie。Session 7 天有效，支持滑动续期。

**i18n 边界** —— Server Component 用 `lib/i18n/server.ts`，Client Component 用 `lib/i18n/client.tsx`，**两者不可混用**。语言偏好存 `locale` cookie，由 `/api/locale` 切换；字典在 `lib/i18n/dictionaries/{en,zh}/`。

**数据模型**（详见 `prisma/schema.prisma`）：
- `User` —— 含 RPG 属性字段（level/attack/defense/hp/agility/luck/specialAttributes），`SkillsRadar` 组件读这些字段渲染。
- `Activity` —— 用户动态，正文 ≤ 280 字符（`lib/validators.ts` 强制），关联 `User`。
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

```bash
DATABASE_URL="file:./prisma/dev.db"   # SQLite（本地）或 Postgres 连接串
```

## Commit 规范

`feat(personal-web): ...` / `fix(personal-web): ...`（遵循顶层工作簿约定）。

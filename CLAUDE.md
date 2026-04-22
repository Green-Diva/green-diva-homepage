# CLAUDE.md — 03-Personal Webpage

Next.js 15 App Router 全栈个人网页，Prisma + SQLite（本地）/ Postgres（生产），Tailwind v4。

## 常用命令

```bash
npm run dev          # 开发
npm run build        # 生产构建
npm start            # 启动生产
npm run db:push      # 同步 schema 到 DB
npm run db:seed      # 重置示例数据
```

## 目录

- `app/` — 路由（页面 + API）
- `components/sections/` — 首页各 section（Hero/About/Projects/Contact）
- `components/admin/ProjectForm.tsx` — 复用的新建/编辑表单
- `lib/db.ts` — Prisma 单例
- `lib/auth.ts` — `Authorization: Bearer <ADMIN_TOKEN>` 校验
- `lib/validators.ts` — Zod schema
- `prisma/` — schema + seed

## 鉴权

所有写 API（POST/PATCH/DELETE）需 `Authorization: Bearer <ADMIN_TOKEN>`。
前端 `/admin` 把 token 存在 localStorage。没有 NextAuth，保持极简。

## Stitch 设计

首页目前是占位骨架，等 Stitch 导出代码到位后，替换 `components/sections/*` 的 JSX。数据层不受影响。

## Commit 规范

`feat(personal-web): ...` / `fix(personal-web): ...`（遵循顶层工作簿约定）。

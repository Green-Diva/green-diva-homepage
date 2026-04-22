# Personal Webpage

一个带后台管理的个人网站项目，面向“作品展示 + 内容沉淀 + 后续持续维护”这三件事来设计。前台负责展示个人品牌、项目卡片和项目详情，后台提供最小可用的项目 CRUD，方便直接在浏览器里维护作品列表，不需要每次都手改代码。

项目目前基于 Next.js App Router 构建，使用 Prisma 管理数据层，默认本地落 SQLite，适合先在本机把内容模型和管理流程跑通；如果后续部署到 Vercel、Railway 或其他平台，再切到 Postgres 即可。

## 项目特点

- 前台首页和项目详情页分离，适合做作品展示与个人表达
- 项目详情支持 Markdown，便于写更完整的背景、方案和复盘
- 内置轻量后台，可新增、编辑、删除项目
- 写接口统一走 Bearer Token 校验，保持实现简单直接
- Prisma 数据模型清晰，后续扩展文章、相册、联系方式都比较容易

## 技术栈

- Next.js 16 App Router
- React 19
- Tailwind CSS v4
- Prisma
- SQLite（本地）/ Postgres（生产可切换）
- Zod

## 项目结构

- app/：页面路由与 API 路由
- components/admin/：后台表单与管理界面
- lib/：数据库、鉴权、校验逻辑
- prisma/：数据模型与 seed 数据
- public/：静态资源

## 本地开发

先创建 .env，并至少写入下面两个变量：

```bash
DATABASE_URL="file:./prisma/dev.db"
ADMIN_TOKEN="replace-with-a-long-random-string"
```

然后执行：

```bash
npm install
npm run db:push
npm run db:seed
npm run dev
```

启动后访问 http://localhost:3000。

## 生产构建

```bash
npm run build
npm start
```

## 主要路由

- `/` — 首页（Hero / About / Projects / Contact）
- `/projects/[slug]` — 项目详情（Markdown 渲染）
- `/admin` — 管理面板（凭 `ADMIN_TOKEN` 登录，localStorage 存 token）
- `/api/projects` — `GET` 列表 / `POST` 新建（需 Bearer）
- `/api/projects/[id]` — `GET` / `PATCH` / `DELETE`（写操作需 Bearer）

`GET /api/projects?all=1` 返回包含草稿的全部项目（需 Bearer）。

## 数据模型

见 prisma/schema.prisma。字段概要：

- slug：唯一标识，用于详情页路由
- title、summary：项目标题和摘要
- description：Markdown 正文
- coverUrl、tags、link、repoUrl：封面、标签、演示地址、仓库地址
- order、published：排序和发布状态
- createdAt、updatedAt：创建和更新时间

## 后台鉴权

所有写操作接口都要求请求头携带：

```bash
Authorization: Bearer <ADMIN_TOKEN>
```

前端后台页会把 token 存在 localStorage，用于当前浏览器会话中的管理操作。这个方案足够轻量，但前提是 ADMIN_TOKEN 要设置成足够长且不可猜的随机字符串。

## 部署

默认 SQLite 适合本地/单机。Railway/Vercel 部署建议：

1. 把 prisma/schema.prisma 的 provider 改为 postgresql
2. 设置环境变量 DATABASE_URL 与 ADMIN_TOKEN
3. 构建时会自动执行 prisma generate
4. 首次部署后执行 npm run db:push 完成 schema 同步

## 适合的后续扩展

- 增加文章或随笔模型，把项目和内容管理拆开
- 增加封面上传或对象存储，而不是只填 URL
- 给首页改成更贴近个人品牌的正式视觉，而不是当前概念风格版本
- 把 ADMIN_TOKEN 方案升级为正式登录系统

# 已踩坑结论 / 工具行为参考

工具 / 框架的非直觉行为，以及由踩坑后固化的项目惯例。CLAUDE.md 不再列举这些，统一指向本文件。**遇到诡异现象先 `Cmd+F` 查这里**。

## 排版与响应式

- **`html` 根字号 = 13px**（不是 16px）。所有 Tailwind `rem` 工具类按这个基准计算 → `w-11` ≈ 35.75px、`w-12` = 39px。**触屏目标 ≥44px 必须用 `w-[44px] h-[44px]`**，不要依赖 `w-11`。
- **桌面 nav 用 `lg:` 断点**（≥1024）。`md:` (768) 不足以舒适放下当前 4 项 nav + `gap-11`，768~1023 走 `MobileNav`。新增 nav 项时重新评估。
- **页面外壳**：`app/page.tsx` 顶层 `<div>` 用 `flex flex-col flex-1`（**不要** `min-h-screen`，body 已经是）；否则 `SiteFooter` 会被挤出视口产生 30px 滚动。
- **`<main>` 加 `md:min-h-0 md:overflow-hidden`**：阻止文字 / 图片 intrinsic 高度把 main 顶大。否则在 800px 视口会有 ~25px 溢出。
- **`min-h-[*]` 反压陷阱**：`HeroPortrait` 之前的 `lg:min-h-[360px]` 等硬地板会撑大父容器，破坏 viewport-locked 布局。需要随容器收缩的元素用 `lg:min-h-0`。
- **等高布局**：用 `grid grid-rows-N gap-X` + 子项 `min-h-0`。**避免** `flex-1` + 不一致的 `min-h-[X]`（min-content 会抢占造成不等分）。
- **移动端字号下限 12px**：`globals.css` 已有 `@media (max-width: 639px)` 规则把 `.font-label.text-\[8/9/10/11px\]` 强制 12px + `letter-spacing: 0.2em`。新加 `font-label` 小字号自动受益，**不要**单独加 `sm:` 前缀重复处理。
- **Tailwind v4 选择器陷阱**：`[class*="text-[Xpx]"]` 在 lightningcss 下不稳；要用 `.font-label.text-\[Xpx\]` 转义类选择器 + `!important` 才能覆盖 Tailwind 生成的 utility。
- **中文行高更高**：`html[lang="zh"]` 全局设 `--tw-leading: 1.8`、`p/li` 显式 `line-height: 1.8`（[globals.css:78-86](../app/globals.css)）。算像素布局时记得中文段落比同样行数英文高 ~10-15%，等高布局两语言下要分别测。
- **Touch 设备悬停**：自定义变体 `touch:`（= `@media (hover: none)`）。给桌面 `hover:` 加效果时一并加 `touch:` 复刻一份，否则手机上看不到态变化。
- **图标统一用 Material Symbols**：`<span className="material-symbols-outlined">menu_book</span>`，不要引入 SVG icon 库。fill / weight 通过 `style={{ fontVariationSettings: "'FILL' 1" }}` 调整。

## API 与安全

- **错误脱敏**：catch 块写 `console.error("[scope] ...", e)`，给客户端只回通用文案 `"create failed"` / `"update failed"`。**不要**回传 `e.message`（会泄露 Prisma "Unique constraint failed on token" 之类 schema 信息）。
- **速率限制 canonical**：[`app/api/vault/unseal/route.ts`](../app/api/vault/unseal/route.ts) 是范本（IP-keyed Map / `MAX_ATTEMPTS=5` / `WINDOW_MS=60_000` / `FAIL_DELAY_MS=600`）。新写敏感写端点（登录、解锁、付费）抄它。**注意**：内存 Map 仅适合单实例 / 低 QPS；多实例部署必须换 Redis 或外部限流。
- **CSRF**：middleware 已统一处理 `/api/*` 的写方法。从外部脚本调写 API 必须带 valid `Origin`，否则 403。同源浏览器请求自动通过。
- **Token 掩码统一格式**：用户 token 在 API 返回前必须 mask 为 `${token.slice(0,4)}…${token.slice(-4)}`（≤8 字符用 `"••••"`）。完整 token **仅在创建用户那次响应**返回一次，之后再也不回传明文。范本 [app/api/users/route.ts](../app/api/users/route.ts) `maskToken()`、[app/profile/TokenField.tsx](../app/profile/TokenField.tsx)。
- **级联删除无审计**：`User` 删除会经 `onDelete: Cascade` 同步清掉 `Session`、`Activity`、`Bio`，**没有日志**。所以前端删除前用 `confirm()`；后端如需追溯请先加 audit table 再开放接口。

## Server / Client 边界

- **不能从 Server Component 传函数到 Client Component**（"Functions cannot be passed directly..."）。排序、表头链接等场景用预计算的字符串/对象（如 `sortHrefs: Record<Field, string>`），不要传 `(field) => string`。
- i18n 严格分边界（Server Component 用 `lib/i18n/server.ts`，Client Component 用 `lib/i18n/client.tsx`，两者不可混用）。新增字典 key 必须**同时**改 `lib/i18n/types.ts` + `en.ts` + `zh.ts`，否则 `tsc` 报错。
- **`"use client"` 用最小子集**：仅在确实需要 hook / state / event 的组件加。`SiteFooter` / `PlaceholderPage` 等纯展示用 `async` server component。Server Component 可以包裹 Client Component 子树，反过来不行。

## 容器组件（Tailwind 高度链）

- **`CyberPanel` 内部包了一层 `<div className="relative z-10 h-full">`** —— 这意味着直接给 `CyberPanel` 加 `flex flex-col min-h-0` className **对子节点无效**（children 的真实父是那层 block div 不是 flex）。新建 5 块垂直布局时务必在 children 外再包一层 `<div className="flex flex-col h-full gap-3 min-h-0">`，否则 `flex-1` / `shrink-0` 全部失效，子区域会被挤成 0 高度。范本 [`AgentClient.tsx`](../app/agent-control/AgentClient.tsx) 详情区。
- **背景图绝对定位 + 槽位百分比坐标**：用 `relative aspect-[3/4]` + `next/image fill object-contain` + 子节点 `absolute -translate-x-1/2 -translate-y-1/2` + 顶层 `top/left` 百分比常量。背景图缺失时给 `<Image onError>` 切到同名 SVG fallback（避免 layout 因 404 崩塌）。范本 [`EquipmentLoadout.tsx`](../app/agent-control/components/EquipmentLoadout.tsx)。

## Prisma 写入陷阱

- **可空 Json 字段写 `null` 必须用 `Prisma.JsonNull`** —— `data: { pipelineConfig: null }` 类型报错。正确写法：`pipelineConfig: parsed.config === null ? Prisma.JsonNull : (parsed.config as Prisma.InputJsonValue)`。范本 [`app/api/agents/[id]/pipeline/route.ts`](../app/api/agents/[id]/pipeline/route.ts)。
- **Partial unique index 不能写在 schema** —— Prisma `@@unique([a, b])` 不支持 `WHERE` 过滤。`AgentSkillEquip` 的"同 agent 同 slotIndex 唯一"靠 API 事务里 `deleteMany({ where: { agentId, slotIndex } })` 先清后插实现，schema 里只放普通 `@@index`。

## 开发缓存（绝对避免）

- **dev 服务器跑着的时候不要跑 `npm run build`** —— production build 写 `.next/` 会覆盖 dev 引用的 chunk 文件，dev 立即报 `Cannot find module '../chunks/ssr/[turbopack]_runtime.js'` 然后整页白屏。恢复需要 `preview_stop` → `rm -rf .next .next-dev` → 重启 dev 进程。验证用 `type-check` + `lint` 即可，build 等所有改动 stable 后单独跑。
- **`rm -rf .next` 时不要让 dev 还在跑** —— 同样会让 turbopack 进入 build-manifest 找不到的循环报错（`Persisting failed: Another write batch or compaction is already active` / `ENOENT build-manifest.json`）。恢复路径同上：先 `preview_stop` → `rm -rf .next .next-dev` → `preview_start`。频繁热更改大量文件偶尔也触发，遇到先重启再查代码。
- **Next.js Image 内存缓存** —— 优化器对图片有 in-memory 缓存（按文件 mtime 索引）。改了 `public/` 下的资源后页面如果还是显示旧图，浏览器硬刷不一定够；需要 `rm -rf .next/cache/images` 或重启 dev。生产环境靠 mtime 自动失效。
- **schema 加 / 删字段后必须重启 dev 进程** —— `npm run db:push` 跑完会重新生成 `@prisma/client`，但已运行的 Next dev 进程把老的 client module 缓存在内存里（HMR 不会换 `node_modules`）。直接刷新页面会走老的字段映射，新列读到 `undefined`，UI 静默走 fallback 分支（如 `status === "ONLINE"` 永远 false → 全部 OFFLINE 渲染）。看到"DB 里值是对的、UI 却像没读到"先怀疑这条；恢复：`preview_stop` → `preview_start`（fresh process），然后 reload 验证。

## 组件交互模式

- **写后必跑 `router.refresh()`**：POST/PATCH/DELETE 完成后客户端调 `router.refresh()` 重拉服务端数据，App Router 不会自动失效。落地范本：[LanguageSwitcher](../components/LanguageSwitcher.tsx)、[BioEditor](../app/profile/BioEditor.tsx)、[ActivityList](../app/profile/ActivityList.tsx)、[UsersTable](../app/admin/users/UsersTable.tsx)。
- **下拉菜单**：`useRef + onMouseDown 监听 document + ESC 键`（参考 [UserMenu.tsx](../components/UserMenu.tsx)）。新做 dropdown 沿用，不要自己造。
- **主题化 select 替代原生 `<select>`**：原生 `<select>` 展开后是 OS 渲染的菜单，**完全无法 CSS 控制**（蓝白底）。需要跟主题色一致的下拉用 [`AgentEditor.tsx`](../app/agent-control/components/AgentEditor.tsx) 内的 `ThemedDropdown` 模式：button trigger + `absolute z-50` panel + `aria-haspopup="listbox" / role="option"`。沿用同一模式，不要再硬塞 `<select>` 然后试图调样式。
- **图像裁切上传**：用 `react-easy-crop` + canvas 切片 + 自家 upload endpoint。范本 [`AvatarCropModal.tsx`](../app/agent-control/components/AvatarCropModal.tsx) —— 锁 aspect、zoom 滑杆、Apply 时 `canvas.toBlob` 转 JPEG 上传。新加任何"上传图片到固定显示比例"的流程沿用，不要让用户自己切。
- **全屏抽屉/模态**：`createPortal(...,  document.body)` + `body.style.overflow = "hidden"` + ESC 关闭（参考 [MobileNav.tsx](../components/MobileNav.tsx)）。新模态沿用 portal 模式避免 z-index 战争。
- **不可逆操作确认**：用浏览器原生 `confirm()` + `format(t.x.confirm, { name })` 模板（参考 [UsersTable.tsx](../app/admin/users/UsersTable.tsx) 删除流程），不要自己造确认弹窗。
- **倒计时 / 时间相关组件**：渲染含 `Date.now()` 的内容必须套 `suppressHydrationWarning`（服务端渲染时间戳和客户端初次渲染必然不一致）。参考 [DescentCountdown.tsx](../components/DescentCountdown.tsx)。

## i18n 调试 & 模板语法

- `getDictionary()` 无缓存，HMR 即时生效。文字"没改掉"99% 是浏览器强缓存 / 改错语言文件 / 文本含 `##...##` `**...**` `__...__` 被 hero 解析为高亮（[app/page.tsx](../app/page.tsx) `originBody` 渲染逻辑），不是 SSR 锁。
- **模板占位符**：`format(template, vars)` 用 **双大括号** `{{name}}`，见 [lib/i18n/format.ts](../lib/i18n/format.ts)。新模板字符串遵循。
- **Hero 文本专属 markup**（**仅 `originBody` 解析**）：`##...##` → 大号 `text-secondary` + `sacred-glow`；`**...**` → 中等强调 `text-secondary`；`__...__` → 强调 + glow。其他页面文字不会被解析，照搬 markup 不会变样式。

## 资源与性能

- **远程头像**：`avatarUrl` 是任意外部 host，**未在 `next.config.ts` 配置 `images.remotePatterns` 前不要换 `next/image`**（会运行时崩）。需要懒加载用 `<img loading="lazy" decoding="async">`。
- **静态图与 middleware 鉴权（重要陷阱）** —— middleware 默认对所有路由要求登录，仅 `STATIC_PREFIXES = ["/_next", "/fonts", "/images", "/videos"]` 直通。**Next.js Image 优化器在 SSR 阶段以 server-fetch 拿源图，不带 cookie**，命中鉴权路径会被 307 → `/login`，然后报 `"isn't a valid image"` 渲染 fallback。**所有 `next/image` 要消费的静态资产必须放 `/public/images/...` 下**（路径 = `/images/...`）。把图放进 `/public/<routeName>/`（如 `/public/agent-control/spine.jpg`）会撞 page route 鉴权。范本：所有 agent-control 资产存放于 `/public/images/agent-control/`。新增模块创建 `public/<...>` 目录前先想这条。
- **`next/image` quality 白名单** —— Next 16 要求 `images.qualities` 显式列出可用 quality。当前 [`next.config.ts`](../next.config.ts) 配 `[75, 95]`，需要更高质量传 `quality={95}` 的 `<Image>` 才能生效；用未列入的值会回退到默认 75。新需求要加 q 值时同步改这个数组。
- **视频组件**：`SeamlessLoopVideo` 自动检测 `navigator.connection.saveData` / `effectiveType in {slow-2g, 2g, 3g}` / `prefers-reduced-motion`，命中即退化为静态 `<div>`（背景图 / 纯色）。新做循环视频组件沿用此模式，不要直接用 `<video autoPlay>`。HMR 中间态偶尔短暂走错分支，验证时硬刷新。

## LLM provider 踩坑

- **Opus 4.7+ 拒绝 `temperature` 参数** —— `llmPrompt.ts` 现在默认不传 temperature，只在 handlerConfig 显式设置时才传。
- **Gemini 2.5 + Google Search Grounding 与 JSON response mode 互斥** —— 遇到要 grounded 又要结构化输出的场景（比如 lore 研究），必须**拆成多次调用**。LORE-FORGE-001 范本：loreEn skill 用 grounding 输出 text，loreZh skill 翻译，metadata skill 单独 JSON 派生。
- **Gemini 模型名要稳定版** —— `gemini-2.0-flash-exp` 在 v1beta 已 404，用 `gemini-2.5-flash`（或 `gemini-1.5-flash` 求速度）。
- **JSON 输出注意 maxOutputTokens** —— Gemini 2.5 thinking 烧 token；lore 给 4096、metadata 给 8192 是踩坑后的安全值。

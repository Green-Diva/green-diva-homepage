# Skill Library 字段与 UI 重构（2026-05-10）

`/agent-control?tab=skills` 的一次集中迭代，处理"字段冗余 + 表单陡峭 + 视觉态缺失"三类问题，落地了 5 项改动。本文档记录改了什么、为什么改、动了哪些文件，以及未来注意事项。

## 起因

- DB 17 列里 runtime 真正读到的只有 6 列（`id / nameEn / handlerKind / handlerConfig / inputSchema / outputSchema / status`），其余 11 列大多 UI 装饰或元数据。
- 当前 5 条 skill 100% 是 `INTERNAL`，但表单对 4 类 handler 平均分配 schema 表面积，admin 创建一条 INTERNAL skill 还得手写 `{ "handler": "..." }` JSON。
- LLM tool 名走 `nameEn` slugify + cuid 后缀派生（[orchestrator.ts](../lib/skills/runtime/orchestrator.ts) 旧版本），改名 = prompt cache 失效 + tool_use 历史断裂，无显式标识可控。
- 列表无 `status` 视觉态、无 handler 类型 chip，scan 不出哪条 skill 是远程 / 本地、哪条已 offline。
- Test Invoke 必须先点 Edit 再进 modal 才能用，常用排查路径过深。

## 5 项改动

### 1. 加 `Skill.slug` 字段（稳定机器标识）

- DB：[`prisma/schema.prisma`](../prisma/schema.prisma) `Skill` 模型加 `slug String? @unique @db.VarChar(64)`。
- 一次性 migrate：[`prisma/migrate-skill-slug.ts`](../prisma/migrate-skill-slug.ts) 幂等回填——把 `nameEn` 转 kebab-case，碰撞时附 `<id-tail>` 后缀。串到 `npm start` 链上 `prisma db push` **之后**（其它 migrate 都在 db push 之前）。
- 现存 5 条已回填：`relic-files-summary` / `relic-gemini-researcher` / `relic-smart-image-picker` / `relic-background-cutout` / `meshy-3d-generator`。
- Validator：[`lib/validators.ts`](../lib/validators.ts) 加 `skillSlugSchema = z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, ...)`，`skillCreateSchema.slug` 可选。
- API：[`app/api/skills/route.ts`](../app/api/skills/route.ts) POST 时未提供 slug 自动从 `nameEn` 派生 + 唯一性兜底；P2002 唯一冲突 → 409。[`app/api/skills/[id]/route.ts`](../app/api/skills/[id]/route.ts) PATCH 同样 409 处理。
- Runtime：[`lib/skills/runtime/orchestrator.ts`](../lib/skills/runtime/orchestrator.ts) `toolNameFor` 优先用 `skill.slug`，回退到老的 `nameEn` 派生（兼容未回填行）。

> **Why**：改 nameEn 不应破坏 LLM tool 名稳定性。slug 是 admin 显式控制的"机器接口"，nameEn 是"人类显示"。

### 2. handlerConfig 编辑器按 handlerKind 分流

[`SkillEditor.tsx`](../app/agent-control/components/SkillEditor.tsx) 重写：

- **INTERNAL** → 下拉选 slug（从 6 个内置 handler 列表硬编码：`relic-files-summary` / `relic-gemini-researcher` / `relic-smart-image-pick` / `relic-cutout` / `meshy-3d` / `relic-image-pick`）。新增内置 handler 必须**同步**修改这个列表。
- **HTTP_API** → method（GET/POST/PUT/PATCH/DELETE 下拉）、url、authEnv、headers（JSON）、bodyTemplate（JSON）。
- **LLM_PROMPT** → provider（anthropic/openai 下拉）、model、systemPrompt、userTemplate、maxTokens、temperature、authEnv，并附 "Opus 4.7+ rejects temperature — leave blank" 提醒。
- **MCP_SERVER** → serverUrl、toolName、authEnv，附 "Phase 5 placeholder" 提示。
- 顶部右上 **"Advanced (raw JSON)"** toggle：保留原始 JSON textarea 编辑入口，覆盖结构化字段没暴露的高级配置（`imagePathsField` / `queryTemplate` / `timeoutMs` / `responseFormat` 等）。
- 切换 handlerKind 时清掉已知 kind-specific 字段，保留 admin 自定义键不被误删。

> **Why**：admin 80% 时间填的是 INTERNAL slug 这一个字段，不应被迫看 9 行 JSON 模板。结构化 form 让 INTERNAL skill 的创建从 "写对 JSON" 降到 "选下拉"。

### 3. 列表加 status 视觉态 + handler chip

[`SkillLibrary.tsx`](../app/agent-control/components/SkillLibrary.tsx)：

- 每条 skill 加 `INTERNAL / HTTP / LLM / MCP` chip（中性色，避免和 MECHANICAL 金黄 / AUTONOMOUS 青绿冲突）。
- 加 `● ONLINE / ● OFFLINE` chip（dot + 文本），OFFLINE 整个 cell `opacity-55` 灰显 + icon 改灰、ONLINE chip 用 mode 主色发光。
- 新增 slug 在 skill 名下方以 `font-mono text-[10px]` 灰色显示，调试时一眼看出 LLM tool 名。

> **Why**：scan 列表时第一眼应该回答 "这条是远程还是本地？还能跑吗？"。同时遵循 CLAUDE.md L375 的硬规约——**不**做"点击切换 ONLINE/OFFLINE"快捷开关，避免被未来 healthcheck-driven 重构推翻。

### 4. Test Invoke 上移到列表行 hover action

- 从 [`SkillEditor.tsx`](../app/agent-control/components/SkillEditor.tsx) 移除内嵌的 Test Invoke 段。
- 新建 [`TestInvokeDialog.tsx`](../app/agent-control/components/TestInvokeDialog.tsx)：独立 portal modal，含 sample input textarea + Run 按钮 + 成功/失败结果显示（保留 schema violation 折叠展开）。
- [`SkillLibrary.tsx`](../app/agent-control/components/SkillLibrary.tsx) 每行右上角 admin 区加 `play_arrow` 按钮，点击弹出 TestInvokeDialog。Edit 按钮保留，并排。
- API 端点 `POST /api/skills/[id]/test-invoke` **未变**，只是入口前移。

> **Why**：日常排查"这条 skill 还能跑吗"应该一键调出，不需要先进入编辑态（也避免不小心改坏字段）。

### 5. 砍 / 隐藏 `costAp` 和 `kind` 字段

- SkillEditor 表单移除 Kind 下拉 + AP Cost 输入。
- SkillLibrary 列表移除 PASSIVE/ACTIVE/ULTIMATE badge 和 `AP {{n}}` 显示。
- DB 列保留：`kind` 加 `@default(PASSIVE)`、`costAp` 已有 `@default(0)`、`level` 加 `@default(1)`，让旧 POST 缺这些字段也能落地。
- Validator：[`lib/validators.ts`](../lib/validators.ts) `skillCreateSchema` 把 `level / kind / costAp` 改 `optional()`。
- i18n keys：`skillKindPassive/Active/Ultimate` 和 `skillCostAp` **保留**在字典里（不破 type-check），但运行代码不再引用。

> **Why**：CLAUDE.md L39 已经标记 `kind` 为"纯装饰"。`costAp` 当前 5 条 skill 全是 0、runtime 不读。给 admin 减负，但保留 DB 列以防未来"调用配额"系统再用。

## i18n 增量

[`lib/i18n/types.ts`](../lib/i18n/types.ts) + 字典 `agentControl` 段加 4 个 keys：

| key | en | zh |
|---|---|---|
| `skillStatusOnline` | `ONLINE` | `在线` |
| `skillStatusOffline` | `OFFLINE` | `离线` |
| `skillTestInvoke` | `Test` | `测试` |
| `skillTestInvokeTitle` | `Test Invoke` | `测试调用` |

SkillEditor 内部技术 form labels（`Level / Slug / Icon (Material Symbol) / Handler Type` 等）保持原作者风格的 hardcode 英文——admin-only 工具，作者已默许。

## 文件清单

### 新增

- [`prisma/migrate-skill-slug.ts`](../prisma/migrate-skill-slug.ts) — slug 幂等回填脚本
- [`app/agent-control/components/TestInvokeDialog.tsx`](../app/agent-control/components/TestInvokeDialog.tsx) — 独立 test invoke modal
- [`docs/skill-library-redesign-2026-05-10.md`](skill-library-redesign-2026-05-10.md) — 本文档

### 修改

- [`prisma/schema.prisma`](../prisma/schema.prisma) — Skill 加 `slug`、`level/kind` 加 default
- [`package.json`](../package.json) — `start` 链加 `migrate-skill-slug` 调用（位于 `prisma db push` 之后）
- [`lib/validators.ts`](../lib/validators.ts) — `skillSlugSchema` + skillCreateSchema 字段重排
- [`lib/skills/runtime/orchestrator.ts`](../lib/skills/runtime/orchestrator.ts) — `toolNameFor` 优先 slug
- [`app/api/skills/route.ts`](../app/api/skills/route.ts) — POST 自动派生 slug + P2002 处理
- [`app/api/skills/[id]/route.ts`](../app/api/skills/[id]/route.ts) — PATCH P2002 处理
- [`app/agent-control/types.ts`](../app/agent-control/types.ts) — `SkillRow.slug`
- [`app/agent-control/page.tsx`](../app/agent-control/page.tsx) — 序列化 slug
- [`app/agent-control/components/SkillEditor.tsx`](../app/agent-control/components/SkillEditor.tsx) — 大重写
- [`app/agent-control/components/SkillLibrary.tsx`](../app/agent-control/components/SkillLibrary.tsx) — 大重写
- [`lib/i18n/types.ts`](../lib/i18n/types.ts) — 4 个新 keys
- [`lib/i18n/dictionaries/en.ts`](../lib/i18n/dictionaries/en.ts)、[`lib/i18n/dictionaries/zh.ts`](../lib/i18n/dictionaries/zh.ts) — 4 个新 keys 翻译

## 数据库迁移影响

- 本地 DB 已 `prisma db push --accept-data-loss` 加列，5 条现存 skill 已通过 `npx tsx prisma/migrate-skill-slug.ts` 回填。
- 生产 DB 在下次 `npm start` 自动跑：`prisma db push` 加列 → `migrate-skill-slug.ts` 回填，**幂等**，重启不出副作用。
- `level / kind / costAp` 列**未删**，仅在 schema 上加默认值。未来若决定彻底删，复制 [`prisma/migrate-remove-runtime-config.ts`](../prisma/migrate-remove-runtime-config.ts) 模板做一次 drop column 脚本即可。

## 已验证

- `npm run type-check` 干净。
- `npm run lint` 唯一错误在 [`AgentEditor.tsx`](../app/agent-control/components/AgentEditor.tsx)（pre-existing，与本次改动无关）。
- dev server 重启后 `/agent-control?tab=skills` 可正常 SSR + hydrate；5 条 skill 显示 INTERNAL chip + ● ONLINE chip + slug 小字。
- 点击列表行 Edit 按钮弹出新 SkillEditor，下方 Internal Handler 下拉、Slug 输入、Advanced toggle 都工作。
- 切换 handlerKind 到 LLM_PROMPT 时表单切换为结构化 LLM 字段（provider 下拉 / model / systemPrompt / userTemplate / maxTokens / temperature / authEnv）。

## 已知遗留 / 后续待办

- **`Skill.status` 仍是人工 toggle**（CLAUDE.md L375 已明确未来改 healthcheck-driven）。新 UI 严格遵守"不依赖装上立刻发光体感"的约束——OFFLINE chip 是只读视觉态，不做快捷开关。
- **DB 列 `kind / costAp` 未删**，仅默认值兜底。若未来决定彻底清掉，参考 `prisma/migrate-remove-runtime-config.ts` 模板写一次性 drop。
- **6 个 INTERNAL handler slug 在前端硬编码**（[`SkillEditor.tsx`](../app/agent-control/components/SkillEditor.tsx) 的 `INTERNAL_HANDLER_SLUGS` 常量）。新增内置 handler 必须**两处同步**：[`lib/skills/handlers/internal/index.ts`](../lib/skills/handlers/internal/index.ts) + 这个常量。可以考虑加一个 `/api/skills/internal-handlers` GET endpoint 让前端动态拉取，但目前 6 个数量稳定，PR 时同步成本低于引入额外 endpoint。
- **AgentEditor.tsx 的 lint 错误**应该单独修一次（React hooks 条件调用问题，与本次改动无关）。

## CLAUDE.md 同步建议

[CLAUDE.md](../CLAUDE.md) 中两段需要小幅更新以保持同步：

1. **"数据模型"段 `Skill` 部分**——加一句提到 `slug` 字段是稳定机器 ID + LLM tool 名。
2. **"Skill Handler 与运行时"段**——可补充一行：`SkillEditor` 的 handlerConfig 走结构化分流 + 顶部 Advanced toggle 退到 raw JSON。

不强制现在做；如果你打算把这次重构归档到 CLAUDE.md，按这两个点改即可。

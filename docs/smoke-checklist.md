# Smoke Checklist

按这个清单走一遍，可以快速定位"系统哪一层断了"。每步给一个**短路检查点** (利用已有的 admin 调试入口) + **断了看哪里**。

只跑本地 dev (`npm run dev`)；生产冒烟需要 admin 自己再过一遍 + 真实 env。

> **API 错误响应统一 shape** (2026-05-11 起)：所有 `/api/*` 错误返回 `{ ok: false, errorCode, errorMessage, error }` (`error` 是 back-compat alias，2026-06 后删)。debug 时优先看 `errorCode` 而不是 status code——它给你域+状态，定位更准。详见 [CLAUDE.md "命名规约"](../CLAUDE.md) 段 + [lib/api-error.ts](../lib/api-error.ts)。

---

## Step 0 — Prerequisites

- [ ] `brew services start postgresql@16`
- [ ] `npm run db:push` 已执行 (schema 同步 + migrate 链跑完)
- [ ] `.env` 有 `DATABASE_URL` / `SAFETY_SECRET` / `ADMIN_TOKEN`
- [ ] `npm run dev` 起来，`localhost:3000` 可访问

---

## Step 1 — Login

- [ ] 浏览器开 `localhost:3000/login`，输 admin token。
- [ ] 看 devtools → Application → Cookies，`gd_session` HttpOnly cookie 存在。
- [ ] 跳转到 `/profile` 看到自己的 user row。

**断了看哪里**：
- 401 → `ADMIN_TOKEN` 没对上 / DB 里 seed 没跑 (`npm run db:seed`)。
- 跳回 login → middleware 鉴权出问题 (看终端 `[middleware]` 日志) 或 cookie 没被 set (查 `lib/auth.ts::createSession`)。

---

## Step 2 — Skill 自检 (handler / env / 外部 API)

`/agent-control?tab=skills` → 每个 ONLINE skill 点 SkillEditor → **Test Invoke**：

| Skill | input | 期望 output |
|---|---|---|
| `metadata-init` (LORE-FORGE LLM_PROMPT) | `{ "userBrief": "test", "fileSummary": "n/a", "imageAbsPaths": [], "textExcerpts": "" }` | JSON 含 `nameEn` / `tagsEn` 等字段 |
| `fal-cutout-http` (CUTOUT HTTP_API) | `{ "imageDataUri": "data:image/png;base64,iVBORw0KGgo..." }` (任意 PNG) | `{ "base64": "...", "contentType": "image/png" }` |
| `meshy-3d-http` (MESHY HTTP_API) | 同上 | `{ "base64": "...", "modelUrl": "https://..." }` |
| `serp-image-search` (PICKER HTTP_API) | `{ "query": "test" }` | `{ "results": { "images_results": [...] } }` |

**断了看哪里**：
- 401 / 403 → 对应 env 没设 (LORE 要 `GEMINI_API_KEY`、CUTOUT 要 `FAL_API_KEY`、MESHY 要 `MESHY_API_KEY`、PICKER 要 `SERPAPI_KEY`)。env 名固化在 `handlerConfig.authEnv`。
- 500 / timeout → 外部 API 服务问题；看终端 `[skill:invoke]` 日志找错误码。
- "handlerConfig must not contain plaintext credentials" → validator 拒，说明谁手滑把明文 key 写进了 handlerConfig，改回 `authEnv`。

---

## Step 3 — Scene 自检 (SceneBinding inputMap + scene.outputSchema)

`/agent-control?tab=scenes` → 对每个 `relic.*` scene 点 **Sample Run** 喂最小 ctx：

| Scene | 最小 ctx | 期望 |
|---|---|---|
| `relic.generate-draft-metadata` | `{ "workspaceSlug": "smoke-test", "userBrief": "", "fileSummary": "", "imageAbsPaths": [], "textExcerpts": "" }` | 同步返回，含 `research` 包 |
| `relic.regen-metadata` | 同上 | 同步返回 metadata 字段 |
| `relic.enhance2d` | `{ "relicId": "...", "imageDataUri": "data:..." }` (需先创建一个 Relic) | 异步建 AgentJob |
| `relic.create3d` | 同上 | 异步建 AgentJob |
| `relic.network-image-search` | `{ "relicId": "...", "relicSlug": "...", "referenceImageBase64": "...", "referenceImageAbs": "..." }` | 同步返回 `matches` 数组 |

**断了看哪里**：
- "scene not registered" → `lib/scenes-init.ts` 没 import 对应 module。
- "context schema failed" → ctx 字段不全/类型错；对照 `lib/relics/scenes.ts` 的 `contextSchema`。
- "agent capability not in scene requirements" → SceneBinding 指向的 agent 没装备 `requiredCapabilities`；看 capability 列。
- `SCENE_OUTPUT_INVALID` → agent 末尾 leaf 的输出 shape 跟 `lib/relics/scenes.ts` 该 scene 的 `outputSchema` (Zod) 不匹配。短路：在 `/agent-control?tab=agents` 打开该 agent → BackboneFlowEditor 右栏 **Test Run** → 看末尾 leaf 的 output JSON，对照 `outputSchema` 字段名 + 类型；通常补一个末尾 `transform` 节点把内部 shape 重塑成契约 shape。
- runLog 里 step 失败 → 直接对应到 Step 2 那条 skill 的问题。

---

## Step 4 — Draft 上传 → preview

UI 走：`/relic-collection` → 点空 slot → upload 一个 zip 或单张图。

- [ ] 看到 RelicDraftPanel 三阶段 modal，状态从 `PENDING` → `RUNNING` → `READY_TO_REVIEW`。
- [ ] preview 阶段能看到 `generatedMetadata` (nameEn / loreEn / candidateImages...)。

**断了看哪里**：
- 卡 `RUNNING` 不动 → 看 `RelicDraft.errorMessage` (DB 查) 或终端 `[draft-pipeline]` 日志。
- READY_TO_REVIEW 但 `degraded: true` → metadata 兜底了；看 `stepResults.GENERATE_METADATA.runLog` 找 LLM 哪步炸。
- FAILED → 进 `RelicDraft.errorMessage`，常见 EXTRACT_ZIP 解压失败 / metadata 全链路炸。
- 短路检查：直接打 `relic.draft-metadata` scene 的 sample-run (Step 3)，跳过 EXTRACT_ZIP 看是否单 metadata 段炸。

---

## Step 5 — Confirm draft → Relic

preview modal 点 **确认存入**。

- [ ] DB 里看到新 Relic row，`status = READY`。
- [ ] `private/relics/<finalSlug>/` 目录存在，含 `source/extracted/` + `derived/` + `metadata.json`。
- [ ] `Relic.primaryImagePath` / `candidateImages[].path` 路径前缀已从 `_drafts/<id>/` 改成 `<finalSlug>/`。
- [ ] 跳转到 `/relic-collection/<finalSlug>`，详情页能加载。

**断了看哪里**：
- "slot already taken" → 同 slot 上还有 Relic 或别的 draft，看 `Relic.slot` / `RelicDraft.slot`。
- `fs.rename` 失败 → 看终端报权限或 cross-device，通常是 `private/relics/_drafts/<id>` 不存在 (draft 已被清掉了)。
- 路径没 rewrite → bug in confirm endpoint，看 `app/api/relic-drafts/[id]/confirm/route.ts`。

---

## Step 6 — 2D Enhance (async)

详情页 → AssetTabs → `enhance2d` tab → **生成**。

- [ ] 拿到 jobId，前端 3s 轮询 `/api/relics/[id]/asset-job/[jobId]`。
- [ ] AgentJob 状态 `PENDING → RUNNING → SUCCESS`。
- [ ] DB 里 `Relic.enhancedImagePath` 落地，文件存在 `private/relics/<slug>/derived/enhanced-<ts>.png`。
- [ ] AssetTabs 的 enhance2d tab 显示透明 PNG。

**断了看哪里**：
- AgentJob FAILED → 看 `runLog.entries` 找哪一步炸 (`fal-cutout-http` / `save-asset-enhanced`)。
- SUCCESS 但 enhancedImagePath 没写 → agent 末尾 leaf 没产 `_relicWriteback`；看 SceneBinding 指向的 agent 的末尾 transform 节点 (CUTOUT-FORGE 是 `shape-output`)，或 skill `responseTransform` 没塞 `_relicWriteback`。注意 scene outputSchema 用 `.passthrough()` 让 `_relicWriteback` 穿过 safeParse，但**字段值缺**就什么都不会回写。
- 永远 RUNNING → server crash 后 stale job，看 `lib/server-init.ts::ensureServerInit()` 是否被调过 (新 endpoint 漏调最常见)。
- 短路检查：直接打 `fal-cutout-http` skill Test Invoke (Step 2)，跳过整个 scene + writeback。

---

## Step 7 — 3D Create (async)

`model3d` tab → **生成** (需 enhancedImagePath 已落地)。

- [ ] 同 Step 6 流程，agentJob 跑 MESHY-FORGE。
- [ ] Meshy polling 期间 runLog 持续 update (intervalMs 由 handlerConfig 配)。
- [ ] `Relic.modelPath` 落地，GLB 文件 `private/relics/<slug>/derived/model-<ts>.glb`。
- [ ] 详情页 3D viewer 能加载。

**断了看哪里**：
- 仍是 `enhancedImagePath` null → 前端 disable 应该拦了；如绕过 UI 直接 curl，看 endpoint 校验。
- Meshy polling 超时 (默认 5 分钟) → 任务太复杂或 Meshy 服务慢；handlerConfig 调 `polling.timeoutMs`。
- GLB download 失败 → handlerConfig 的 `download` 段；看 runLog `meshy-3d-http` step 的 output.contentType 是否为 `model/gltf-binary`。

---

## Step 8 — 清理 (optional)

- [ ] 删测试 Relic：UI → 详情页 → 删除，或 `DELETE /api/relics/[id]`。
- [ ] 删 EXAMPLE-XX-* canonical agent：`/agent-control?tab=agents` → roster → 删。
- [ ] 看 `private/relics/<slug>/` 已被 fs.rm (DELETE endpoint 应该清，没清就手删)。

---

## 各层断点速查表

| 现象 | 大概率在哪 |
|---|---|
| login 进不去 | `middleware.ts` / `ADMIN_TOKEN` env / DB seed |
| skill test-invoke 401/403 | `handlerConfig.authEnv` 指向的 env 没设 |
| skill 500 | 外部 API 问题，看 `console.error("[skill:invoke] ...")` |
| scene sample-run "context schema failed" | ctx 字段缺/类型错，对照 `lib/relics/scenes.ts` |
| scene sample-run "agent capability not in scene requirements" | SceneBinding 指错 agent / agent 没装 capability |
| draft 卡 RUNNING | `RelicDraft.errorMessage` 或 server crash 残留 (server-init 自动 cleanup 10min 阈值) |
| AgentJob SUCCESS 但 relic 列没更新 | `_relicWriteback` payload 没生成；查 agent 末尾 leaf 输出 (Test Run)，或看是否报 `SCENE_OUTPUT_INVALID` |
| 路径还是 `_drafts/<id>/...` | confirm endpoint 的路径 rewrite 漏了 |
| 永久 RUNNING (无任何错误) | 新 endpoint 漏调 `ensureServerInit()` |

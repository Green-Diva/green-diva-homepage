# Agent Service + Forge Agents

**Site-wide agent dispatch layer.** 任何模块通过 `dispatchScene` / `callScene` 调用"满足某 scene 需求的 agent"，不知道也不关心是哪个 agent / 怎么配的。Endpoint 是薄壳（< 30 行），admin 在 `/agent-control?tab=scenes` 改 SceneBinding 即可换 agent，0 commit。

## 三层路由链路（2026-05-12 all-in 后）

```
浏览器 → POST /api/relics/[id]/enhance-2d              ← endpoint 永不变
              ↓
        dispatchScene("relic.enhance2d", { relicId, ... })
              ↓
        scene.contextSchema.parse(ctx)                  [代码 / Zod]
              ↓
        scene.prepareAgentInput(ctx, actor)             [代码 / 同步纯函数,默认 identity]
              ↓
        SceneBinding 表 (DB)：admin 改 agentId (纯路由)
              ↓
        executeAgent → backbone DAG → handler (HTTP_API / LLM_PROMPT / MCP_SERVER)
              ↓
        scene.outputSchema.safeParse(leaf.output) → SCENE_OUTPUT_INVALID 或继续
```

> **2026-05-12 改造要点**：`SceneBinding.inputMap` (DB Json 模板) 退场，ctx → agent.input 改由 `scene.prepareAgentInput(ctx, actor)` 在 `lib/<module>/scenes.ts` 内 own。SceneBinding 现在是真"纯路由表"（`{ sceneKey, agentId, enabled, notes }`）。换 agent 仍是 0 commit，但**改 agent.input 形状变成 git PR**——这是把 scene 契约固化到代码层的代价（详见 [`SceneDefinition.prepareAgentInput`](../lib/agent-service/types.ts) 注释）。

## 术语对照（避免歧义）

- **技能池（skill pool）** = 某个 agent 当前已装备且可用（ONLINE）的 skills 集合。Backbone 与 Orchestrator 使用的是同一个技能池，不是两套独立池。
- **equippedSkillIndex（仅 Orchestrator 运行时）** = 从技能池临时构建的"工具名 -> Skill"索引，用于 LLM 发起 tool call 后快速定位 skill；它不是第二份 skill 数据，也不是额外配置面。（旧文档术语 `toolMap`）
- **SceneBinding** = "scene -> agent"路由配置（不是 skill 路由）。skill 的归属关系由 `AgentSkillEquip` 决定。

## Forge agents

每个 forge 专职一个能力域，DAG 由 HTTP_API + LLM_PROMPT skill 组装；控制流 / 数据塑形由 backbone 原语 (loop / forEach / transform) 表达，**没有 INTERNAL handler**。

**2026-05-12 合并**：原 LORE-FORGE-001 / CUTOUT-FORGE-001 / MESHY-FORGE-001 三个单一职责 agent 合并成 **RELIC-FORGE-001** —— 一个 4-way mode branch 的 omni-agent，绑 4 个 relic.* scene。**2026-05-13**：save-asset-relic skill 退役为 backbone `persist` 原语，RELIC-FORGE-001 槽位从 6 降到 5（slot 5 留空）。**2026-05-14**：PICKER-FORGE-001 + `relic.smart-image-pick` scene 整体退役，draft pipeline 改为「最大 user 候选作主图」的同步逻辑。

| Forge | 职责 | 槽位结构 |
|---|---|---|
| **RELIC-FORGE-001** | Relic 全生命周期（绑 `relic.generate-draft-metadata` + `relic.regen-metadata` + `relic.enhance2d` + `relic.create3d` 4 个 scene） | 顶层 mode-branch on `input.mode`,4 个 case 分别路由到 4 条独立链:<br>① `initial` → loreEn (slot 0, Gemini grounding+vision) → loreZh (slot 1, Gemini text) → metadata-init (slot 2, Gemini json+vision) → **wrap-research transform** (产 `{ research: {...} }`)<br>② `regenMetadata` → metadata-regen (slot 2,复用同一 skill,flat shape 直接 leaf)<br>③ `2dEnhance` → cutout (slot 3, fal-cutout-http) → **save-cutout (persist 原语)** → **shape-cutout transform** (产 `{ enhancedImagePath, _relicWriteback }`)<br>④ `3dCreate` → meshy (slot 4, meshy-3d-http) → **save-meshy (persist 原语)** → **shape-meshy transform** (产 `{ modelPath, taskId, previewImageUrl, _relicWriteback }`)<br>**`agent.input.{userBrief,fileSummary,imageAbsPaths,textExcerpts}` 由 [`scanWorkspace`](../lib/relics/pipeline/scanWorkspace.ts) 预填;`imageDataUri` 由 endpoint 用 [`readRelicImageAsDataUri`](../lib/relics/readImageAsDataUri.ts) 预编码;`mode` 和 `kind` 由 [scene.prepareAgentInput](../lib/relics/scenes.ts) 注入**。 |

**Skill / Agent / 原语 责任边界（不可越界）**：

- **Skill = 原子外部 IO**：一个 skill 只做一次外部调用（一次 HTTP / 一次 LLM 调用），输出 raw 响应字段。**不要**在 skill 的 `responseTransform` 里组装 `_relicWriteback`、不要拼 scene-shape 字段、不要嵌业务编排逻辑——skill 不应该"知道"自己服务于哪个 relic / 哪个 scene。
- **Runtime 原语（persist / transform / loop / forEach / branch）= 同进程基础设施**：不占 skill 槽，不计入装备上限，admin 在 BackboneFlowEditor 里直接拖。`persist` 是 2026-05-13 加入的数据持久化原语——把 base64 写到 `private/relics/<slug>/derived/`，输出 `{ savedPath, absPath, bytes, contentType }`。它与 runner 的 `_relicWriteback` hook 对称（一个是 file persistence、一个是 DB-column persistence，两个都是 runtime infrastructure）。
- **Agent = 封装 + scene 契约塑形**：agent 的末尾 `transform` 节点（如 `wrap-research` / `shape-output`）负责把 skill / 原语 的输出 + `agent.input.*` 合并成 scene `outputSchema` 期望的 shape，包括 `_relicWriteback` 这种 runner 用的回写信封。**Agent 是契约 owner，skill / 原语 是工具**。
- 历史教训：persist 之前被建模成 HTTP_API skill (`save-asset-relic` / `save-network-asset`)，调的"外部 API"是我们自己的 `/api/internal/save-asset` + HMAC-derived token。这其实是数据持久化基础设施套了一层 HTTP 壳，占着 skill 槽不放。2026-05-13 一次性纠正——endpoint、token 派生、middleware 豁免链路全部退役。

**"看起来重复的 skill 何时不该合"判断规则**：只看 `provider` / `model` / `authEnv` 几行相同**不算冗余**，4 个维度任一不同就**不要合**：

1. **modality**（`grounding` / `imagePathsField` / `responseFormat`）——`handlerConfig` 是静态 DB 字段，**不能按 runtime input 切**。强合会被迫总跑重型 modality（白烧配额）或永久降级（丢功能）。
2. **inputSchema**——决定 AUTONOMOUS 下 LLM 看到的 tool 签名。合并的 schema 会让 LLM 看不出"什么时候该传哪些字段"。
3. **systemPrompt 语义任务**——研究 / 改写 / 翻译 / 抽取是不同任务，合一个 prompt 上下文切换成本高，输出质量降。
4. **延迟 / 配额画像**——重型（带 grounding/vision，~3-8s + Search API）和轻量（纯 text，<2s）合一起会让所有调用都按重型计费。

范例：`gemini-lore-en` 和 `gemini-lore-zh` 共享 provider/model/authEnv，但 modality（grounding+vision vs 纯 text）、inputSchema（4 字段 vs 1 字段）、prompt 语义（研究+创作 vs 改写+精炼）、延迟画像全不同——它们是 DAG 的相邻步骤，不是 skill 的冗余。真想"看着不那么乱"，应该走 backbone editor 的 sub-pipeline 折叠（未来功能），不是改 skill 层。

**IO 放哪里：现状 = pipeline/endpoint 层做完，agent 接 ready-to-use 输入**

所有 forge 走"pipeline-准备"路径，agent DAG 不再有 INTERNAL handler。LORE-FORGE 的 `scanWorkspace`、CUTOUT/MESHY 的 `readRelicImageAsDataUri`、PICKER 的 `stageUserCandidates` 都是这个 pattern：把 FS / Prisma 接触面留在 pipeline / endpoint 层，agent 只做 HTTP+LLM 编排。**规则 + helper 命名约定 + 反模式清单**见 [docs/pipeline-input-pattern.md](pipeline-input-pattern.md)。新加 scene 前先读那一篇。

**反模式（已彻底拒绝）**：单一 INTERNAL 同时干 Prisma 查 + FS 扫 + 字符串拼装 + LLM-friendly 塑形（已删 `relic-files-summary`），或单一 INTERNAL 编排"双轮 vision filter + 跨轮 score 合并"业务流（已删 `relic-smart-image-pick`；PICKER-FORGE DAG 重写后又于 2026-05-14 整体退役，draft pipeline 改回纯排序逻辑）。

## 4 个 relic.* scenes

| Scene | invocation | 当前 binding | 触发位置 |
|---|---|---|---|
| `relic.generate-draft-metadata` | sync (callScene) | RELIC-FORGE-001 (mode=initial) | [generateMetadata pipeline step](../lib/relics/pipeline/steps/generateMetadata.ts) |
| `relic.regen-metadata` | sync | RELIC-FORGE-001 (mode=regenMetadata) | [regen-metadata endpoint](../app/api/relics/[id]/regen-metadata/route.ts) |
| `relic.enhance2d` | async (dispatchScene) | RELIC-FORGE-001 (mode=2dEnhance) | [enhance-2d endpoint](../app/api/relics/[id]/enhance-2d/route.ts) |
| `relic.create3d` | async | RELIC-FORGE-001 (mode=3dCreate) | [create-3d endpoint](../app/api/relics/[id]/create-3d/route.ts) |
| `relic.network-image-search` | sync | LENS-FORGE-001 | [lens-search endpoint](../app/api/relics/[id]/lens-search/route.ts) |

## Pipeline-step / endpoint 解耦（scene 契约模型）

**Scene 输出契约 = 代码层 authoritative，不在 DB**。每个 scene 在 [`lib/relics/scenes.ts`](../lib/relics/scenes.ts) 用 Zod 声明完整 `outputSchema`（含 regex / enum / length 等结构性硬约束），dispatch.ts (sync) + runner.ts (async) 在 leaf 输出后强制 `safeParse`，不符返回 `SCENE_OUTPUT_INVALID` 并阻断 writeback hook。

Pipeline step / endpoint 直接读 `result.output.<scene-shape-fields>`——因为 scene 契约保证 shape 一定对。Agent 内部怎么实现 scene 契约是 agent 自己的事——通常在 backbone DAG 末尾加一个 `transform` JSONata 节点把上游 leaf 输出塑形成契约 shape（参考 4 个 forge agent 的 wrap-research / shape-output 节点）。

**换 agent 不动 binding**：admin 在 SceneBindingEditor 把 SceneBinding.agentId 改到新 agent 时，新 agent 的末尾 leaf 必须满足同一个 scene contract（在 BackboneFlowEditor 里看 scene contract 提示 + Test Run 验证）。SceneBinding 表只剩 `{ sceneKey, agentId, enabled, notes }` —— 纯路由，**不再有 outputMap**（2026-05-11 退场）**也不再有 inputMap**（2026-05-12 退场，改由 `scene.prepareAgentInput` 在代码层 own）。

## `prepareAgentInput` 是"标准信封"，不是 agent 适配器

`scene.prepareAgentInput(ctx, actor)` 输出的 `agent.input` 形状由 scene 单方面决定，**对所有候选 agent 一视同仁**。允许做的只有三类：

1. 字段重命名（`relicId` → `_relicId` 这种全站协议）
2. 注入跨 agent 共享的常量（`mode: "initial"` / `kind: "model"` 这种 scene 自己的语义 discriminator）
3. 简单包装（裹一层 `{ research: ... }`）

**反模式（破坏 scene 契约）**：

- ❌ "新 agent 想要字段叫 `imgUri` 不叫 `imageDataUri`，改 prepareAgentInput 一下" —— 让新 agent 在它 DAG 入口加 `transform` 翻译，**不动信封**。
- ❌ 在 prepareAgentInput 里跑 fetch / Prisma / FS —— 它是同步纯函数，IO 留在 caller（pipeline / endpoint 层，参考 `scanWorkspace` / `readRelicImageAsDataUri` / `stageUserCandidates`）。
- ❌ 数组 map/filter/zip / 多源合并 / 控制流 —— 那是 agent 内部 transform 节点的活。

经验法则：**prepareAgentInput 函数体 ≤ 10 行**。超了多半是把 agent 适配逻辑误塞进信封了——挪到该 agent 的 DAG 入口 transform 节点。

## BackboneFlowEditor 装饰节点视觉模型

`/agent-control` BackboneFlowEditor 的 DAG 画布周围自动注入装饰节点（read-only，不参与 buildConfig 序列化），反映 runtime 真实流：

```
BEGIN_sceneA ─dash─┐                                            ┌─dash─→ END_sceneA
BEGIN_sceneB ─dash─┼─→ AGENT.INPUT ─solid─→ [DAG] ─solid─→ AGENT.OUTPUT ─dash─→ END_sceneB
BEGIN_sceneC ─dash─┘     (单点收敛)                             └─dash─→ END_sceneC
```

- **BEGIN / END**：每个绑定 scene 一个，展示该 scene 的 ctx fields / outputSchema fields。**多个 = 候选 alternative**，不是并发流（一次 invocation 只有一个 BEGIN→END 被实际命中）。
- **AGENT.INPUT / AGENT.OUTPUT**：单点收敛节点。反映"一次 invocation = 1 个 input + 1 个 output"的本质。
- **边样式语义**：
  - `dashed` sky / pink = 候选关系（"这些 scene 可能触发" / "这些 schema 可能校验"）
  - `solid` sky / pink = 实际运行时数据流（agent.input 进入 DAG / leaf output 离开 DAG）
- **拓扑设计动机**（2026-05-12 改造）：原"每个 BEGIN 连所有根、每个 leaf 连所有 END"的 N×M 模型在 RELIC-FORGE-001 这种 4-scene 多 leaf 场景下退化成 16 根交叉乱线，且暗示了错误的语义（并发数据流）。收敛节点模型把边数从 N×M 压成 N+M+2，且视觉直接表达 runtime 行为。

代码：[`topology.ts::buildIoNodes/buildIoEdges`](../app/agent-control/components/backbone/topology.ts) + [`DecorativeNodes.tsx`](../app/agent-control/components/backbone/nodes/DecorativeNodes.tsx) 的 5 个 view (`BeginNodeView` / `EndNodeView` / `AgentBoundaryView` / `AgentInputNodeView` / `AgentOutputNodeView`)。

## 异步 writeback hook（数据驱动）

[`runner.ts::maybeWriteRelicAsset`](../lib/skills/runtime/runner.ts) 单一数据驱动路径：agent leaf output 含 `_relicWriteback: { id, fields }` → 按 **15 字段 allowlist**（`enhancedImagePath` / `modelPath` / `loreZh` 等）写 Relic 列。CUTOUT/MESHY 等 async 路径的 leaf transform 必须在产出 scene-shape 字段同时保留 `_relicWriteback`（scene outputSchema 用 `.passthrough()` 允许该字段穿过校验）。**不要**依赖 `input.mode` 字段做回写路由。

## `persist` primitive (取代旧 save-asset 端点)

2026-05-13: `POST /api/internal/save-asset` 端点 + `INTERNAL_SERVICE_TOKEN` HMAC 派生 + middleware 豁免链路**整体退役**。文件持久化改由 backbone `persist` 原语节点（与 `transform` / `loop` / `forEach` / `branch` 并列的 6 种节点类型之一）在 runtime 进程内直接调 [`lib/relics/persistAsset.ts`](../lib/relics/persistAsset.ts)。

- 节点形状：`{ id, type: "persist", inputFrom, position? }`，无 node-level config。
- 输入契约：inputFrom 解析为 `{ relicSlug, kind, base64, contentType?, ext? }`。通常 inputFrom 用 merge ref：`relicSlug` / `kind` 从 `agent.input` 拉（scene.prepareAgentInput 注入），`base64` / `contentType` 从上游 download skill 拉。
- 输出契约：`{ savedPath, absPath, bytes, contentType }`。下游 `transform` 节点用 `savedPath` 组装 `_relicWriteback`，runner hook 再写回 Relic 列。
- 文件落点：`private/relics/<slug>/derived/<kind>-<ts>.<ext>`。Path-traversal 双重防护（regex + path.resolve 边界检查）。
- **为什么是 runtime 原语而不是 skill**：它和 runner 的 `_relicWriteback` 是同一类基础设施——DB 列持久化 + 文件持久化都是 runtime infrastructure，不是外部能力。占着 skill 槽不对称，且套 HMAC 鉴权环路完全是冗余（同进程调自己）。

## Loop / forEach / transform / persist primitives

backbone DAG v2 节点共 6 种 type：`skill` / `branch` / `loop` / `forEach` / `transform` / `persist`。除 `skill` 外都是 runtime 原语，不占装备槽。

- **`loop`**：Body 自包含 sub-DAG，每次 iteration 用前次 leaf output 作 input；遇到 exitWhen 匹配 / 达 maxIterations 退出。aggregate=`"last"`(default)/`"concat-array"`。
- **`forEach`**：Body 同 sub-DAG 模式，每次 iteration 接 array 中一项；body 入口 `agent.input = { item, index, total }`。aggregate=`"concat-array"`(default)/`"last"`。`maxItems` 1-50 截断。
- **`transform`**：纯 [JSONata](https://docs.jsonata.org) 表达式 evaluate inputFrom-resolved value，无外部调用 / 无 sub-DAG。用于 zip / map / filter / reduce / merge object。表达式在 validateAndNormalize 时 parse-once（malformed 表达式立即报 PIPELINE_INVALID，不等到 runtime）。
- **`persist`** (2026-05-13)：数据持久化原语，见上一段。输入 `{ relicSlug, kind, base64, contentType?, ext? }`，输出 `{ savedPath, absPath, bytes, contentType }`。同进程写 `private/relics/<slug>/derived/`。

`MAX_LOOP_DEPTH = 2` 同时约束 loop + forEach 的递归深度（共享预算）。runtime 里 `runBackbone` 通过 `_internalEquips` / `_depth` / `_runLog` / `_stepIdPrefix` internal opts 递归调自身处理 loop / forEach body — 不抽 helper、不破坏现有 DAG。

**Editor**：[`BackboneFlowEditor.tsx`](../app/agent-control/components/BackboneFlowEditor.tsx) 主画布工具栏 `+ Skill / + Branch / + Loop / + ForEach / + Transform / + Persist` 六个按钮；loop / forEach 节点点 panel 里"▷ Edit Loop Body" / "▷ Edit forEach Body" 弹 `BodySubCanvasEditor` modal（同一 React Flow，header copy + 配色按 `kind` prop 切）。Sub-canvas 工具栏 `+ Skill / + Branch / + Transform / + Persist`（**不允许** 嵌套 loop/forEach 进 body — 想做 depth-2 走 Advanced raw JSON）。Transform 节点 panel 是 JSONata 表达式 textarea，链接到官方文档。Persist 节点 panel 只有 inputFrom 编辑器 + 契约提示。

详见 [backbone.ts](../lib/skills/runtime/backbone.ts)。

## Agent export/import

`GET /api/agents/[id]/export` 返回 `green-diva-agent-export-v1` JSON envelope（agent meta + DAG + 全部装备 skill 完整定义 + slot）。`POST /api/agents/import` 处理 codename 冲突（409 + 显式 newCodename rename）+ skill slug 冲突（`reuse` 默认 / `rename` 自动 `-imp-N` 后缀）。新 agent `deployedAt = null` — admin 测试后自己 deploy。

## LORE-FORGE prompt 默认值

`DEFAULT_LORE_EN_PROMPT` / `DEFAULT_LORE_ZH_PROMPT` / `DEFAULT_METADATA_PROMPT` 在 [`lib/skills/relic-prompts.ts`](../lib/skills/relic-prompts.ts)（无 `server-only`，让 migrate scripts 也能 import）。LORE-FORGE 的 3 个 LLM_PROMPT skill 在 migrate-lore-forge 创建时 seed 这些 prompt 作为 systemPrompt 默认值；admin 在 SkillLibrary 改 `handlerConfig.systemPrompt` 即覆盖。

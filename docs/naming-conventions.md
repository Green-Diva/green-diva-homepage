# 命名规约（跨层契约）

`/agent-control` 的后端 / API / type 系统跨几个层有几条已固化的命名规则。**新加端点 / type / 字段时一律按这里来**，旧代码看到不一致的不要随手"对齐"——多数已经是 back-compat 兜底。

## 2026-05-11 命名收敛清单

下面这些在 2026-05-11 一并改了，每条都带 back-compat 路径，**新代码用新名**：

| 旧 | 新 | back-compat |
|---|---|---|
| `SceneError.code` 字段 | `SceneError.errorCode` | `code` getter 保留至 2026-06 |
| `invokeAgent()` | `executeAgent()` | `invokeAgent` 作为 deprecated re-export 保留至 2026-06 |
| scene key `relic.draft-metadata` | `relic.generate-draft-metadata` | `registerSceneAlias` 解析旧 key，DB 一次性 migrate-rename-scene-keys.ts 重写 |
| `Agent.endedAt` (DB column) | `Agent.finishedAt` (Prisma 字段) | Prisma `@map("endedAt")` —— DB column 名暂未改，仅 TS 字段名换 |
| pipelineConfig JSON 中 `equipSlot` 字段 | `slotIndex`（对齐 `AgentSkillEquip.slotIndex` 列） | migrate-rename-equipslot.ts 一次性 JSON 重写（递归 loop/forEach body） |

## 2026-05-12 SceneBinding.inputMap 退役（all-in）

| 旧 | 新 | back-compat |
|---|---|---|
| `SceneBinding.inputMap` (DB Json, `{{ctx.X}}` / `{{actor.X}}` 模板) | `scene.prepareAgentInput(ctx, actor)` (代码层同步函数, `lib/<module>/scenes.ts`) | DB 列由 [migrate-drop-inputmap.ts](../prisma/migrate-drop-inputmap.ts) 一次性 dump + DROP COLUMN；无运行时 back-compat，新代码直接走 scene.prepareAgentInput |
| `applyTemplate(binding.inputMap, ...)` (dispatch.ts / sample-run.ts) | `scene.prepareAgentInput(ctx, actor) ?? ctx` | applyTemplate 函数本身保留——仍被 skill handlers (httpApi / llmPrompt) 用于 `{{input.X}}` 模板 |
| `AgentErrorCode.TEMPLATE_ERROR` | `DISPATCH_FAILED` (prepareAgentInput throw 时) | TEMPLATE_ERROR 枚举值保留，仅用于历史 AgentJob 行的类型兼容 |
| `SceneBindingRow.inputMap` (page.tsx / types.ts 序列化) | 字段删除 | — |
| `SceneBindingEditor` 的 Input Map (JSON) textarea + JSON 校验 | 编辑器只剩 agent / enabled / notes | — |
| `BackboneFlowEditor` 多 scene 场景下基于 inputMap 静态求值 branch 的 BEGIN/END 反向连接 | 改用 `AGENT.INPUT`/`AGENT.OUTPUT` 单点收敛节点 | BEGINs → AGENT.INPUT → DAG → AGENT.OUTPUT → ENDs;dashed=候选关系,solid=实际运行时数据流。详见下方"装饰节点视觉模型"段 |

**取舍说明**：admin 不再能 0-commit 改 ctx → agent.input 形状；改 scene 入参形状现在是 git PR。这是把 scene 契约固化到代码层换来的：完整 TS 推导 + 单一 source of truth + agent 可移植性增强。详见 [`SceneDefinition.prepareAgentInput`](../lib/agent-service/types.ts) 注释。

API 错误响应统一同期落地（[lib/api-error.ts](../lib/api-error.ts)）；详见下面段。

## API 错误响应 shape

**统一格式**（[lib/api-error.ts](../lib/api-error.ts)）：

```jsonc
{ "ok": false, "errorCode": "<DOMAIN>_<STATE>", "errorMessage": "<human>", "error": "<alias>" }
```

`error` 字段是 errorMessage 的 back-compat alias，给老前端 fetch 用，**2026-06 后删**。新代码读 `errorCode` / `errorMessage`。

写错误响应用 3 个 helper，**不要再 `NextResponse.json({ error })`**：

```ts
import { respondError, respondAuthError, respondValidationError } from "@/lib/api-error";

if (e instanceof AuthError) return respondAuthError(e);
if (!parsed.success) return respondValidationError(parsed.error.flatten());
return respondError(AgentErrorCode.NOT_FOUND, "agent not found", 404);
```

## Error code 命名

- **唯一来源**：所有 error code 从 [`lib/agent-errors.ts`](../lib/agent-errors.ts) 的 `AgentErrorCode` enum 取。`respondError` / `AgentRunResult.errorCode` / `SkillInvokeResult.errorCode` / `SceneError.errorCode` 全部收紧为 `AgentErrorCode` 类型——写 raw string tsc 直接报错。新加 code = 在 enum 加一项 + 在 [`lib/agent-errors-i18n.ts`](../lib/agent-errors-i18n.ts) 加一行中文 hint（`DIAGNOSTIC_HINTS_ZH` 是 `Record<AgentErrorCode, string>`，少一条 tsc 报错）。
- 全大写下划线 `<DOMAIN>_<STATE>`：`SLOT_EMPTY` / `SKILL_OFFLINE` / `SCENE_OUTPUT_INVALID` / `AGENT_MISSING` / `BRANCH_NO_MATCH`
- DOMAIN 候选：`AUTH` / `VALIDATION` / `NOT_FOUND` / `CONFLICT` / `SCENE` / `AGENT` / `SKILL` / `SLOT` / `SCHEMA` / `RUNTIME` / `PROVIDER` / `INTERNAL`
- STATE 候选：`REQUIRED` / `FORBIDDEN` / `FAILED` / `INVALID` / `MISSING` / `EMPTY` / `OFFLINE` / `TIMEOUT` / `DISABLED` / `NOT_DEPLOYED` / `CONFLICT`
- **历史遗留不跟规约的**：`TIMEOUT` / `INPUT_SCHEMA_VIOLATION` / `OUTPUT_SCHEMA_VIOLATION` / `HANDLER_ERROR` / `PROVIDER_ERROR` 等——**不要重命名**，client catch 块可能在做字符串 compare。新加的必须跟规约。
- **日志统一前缀**：runtime / handler 失败路径用 [`logError(source, code, message, data?)`](../lib/agent-errors.ts) helper，输出 `[source:CODE] message` 格式（如 `[backbone:SLOT_EMPTY] node "X": ...`），方便 grep 定位。`LogSource` 类型枚举所有来源标签。

## Error 字段名：`errorCode` 不是 `code`

所有 discriminated-union failure type 都用 `errorCode` 字段（`AgentRunResult` / `SkillInvokeResult` / `SceneError` / API response）。`SceneError.code` 保留为 deprecated getter，**2026-06 后删**——catch 块写 `e.errorCode`，不写 `e.code`。

## 三个 input* 字段不是同义词（不要统一）

容易混淆，但分别属于三个层、三件不同事：

| 字段 | 位置 | 含义 |
|---|---|---|
| `inputMapping` | v1 pipelineConfig step ([validators.ts](../lib/validators.ts)) | legacy 线性 pipeline 的入参引用，仅 back-compat |
| `inputFrom` | v2 DAG 节点 ([validators.ts](../lib/validators.ts)) | DAG node 的入参 source-ref (`"agent.input"` / `"<id>.output"` / `{merge}`) |
| `prepareAgentInput` | SceneDefinition ([lib/relics/scenes.ts](../lib/relics/scenes.ts)) | scene ctx → agent.input 的同步函数（2026-05-12 取代旧 SceneBinding.inputMap DB 模板） |

记不住的话：**"前一个节点叫什么"是 inputFrom，"外部 ctx 怎么映射进来"是 scene 自己的 prepareAgentInput**。

## JSON 字段后缀分类（Prisma model 上的 `Json` 列）

| 后缀 | 用途 | 例子 |
|---|---|---|
| `*Config` | 声明性配置 (DAG / 模型 / 模板) | `pipelineConfig` / `dispatcherConfig` / `handlerConfig` |
| `*Log` / `*Trace` | 执行记录数组 (按时间顺序) | `runLog` / `pipelineTrace` |
| `*Map` | template / 映射对象 | `intentSceneKeys` array 等（`SceneBinding.inputMap` 已于 2026-05-12 退役） |
| `*Metadata` / `*Snapshot` | 快照 / 镜像 | `generatedMetadata` (RelicDraft) |

新 Json 列按这条规则命名；不要起 `*Data` / `*Info` 这种含义模糊的后缀。

## 文件命名：`<verb>.ts` vs `<noun>.ts`

- **verb 文件 = 公开入口**：`invoke.ts` / `dispatch.ts`——一个文件只有一个主导出，名字就是该入口动词
- **noun 文件 = 内部引擎 / registry / types**：`backbone.ts` / `orchestrator.ts` / `runner.ts` / `registry.ts` / `types.ts`——存机制 / 数据 / 配置

barrel `index.ts` 仅在需要明确 public surface 的 package 用（[lib/agent-service/index.ts](../lib/agent-service/index.ts) 是范例）；纯内部模块（`lib/skills/runtime/`）不必有。

## 动态段 segment `[id]` vs `[skillId]`

Next.js 嵌套路由约定：

- 第一层 `[id]`——通用占位（资源主键）
- 第二层及以下用具名（`[skillId]` / `[jobId]` / `[sceneKey]`）以消歧义——同一 handler 文件能拿到多个 `params.X`

API path segment 风格：**static 段一律 kebab-case**（`dry-run` / `sample-run` / `test-invoke` / `enhance-2d`）；**dynamic 段一律 camelCase**（`[skillId]`）。新加路由跟着这条。

## 同义但不同名的"测试执行" endpoint

三个名字（**不要重命名**，client UI 已经写死）：

| 资源 | endpoint | 用途 |
|---|---|---|
| Skill | `POST /api/skills/[id]/test-invoke` | SkillEditor "Test Invoke" 按钮——验 handlerConfig + schema |
| Scene | `POST /api/scene-bindings/[sceneKey]/sample-run` | SceneBindingEditor "Sample Run"——验 prepareAgentInput + 绑定 agent |
| Agent | `POST /api/agents/[id]/dry-run` | BackboneFlowEditor "Test Run"——验 DAG 整体执行 |

三者都是同步、admin-only、不建 AgentJob、不写库。区别在**测的层级不同**：skill / scene / agent。

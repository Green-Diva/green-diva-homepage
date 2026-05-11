# Skill Handler System — 整体规划

> **状态**：2026-05-07 创建。Phase 1 ✅、Phase 2 ✅、Phase 3 ✅、Phase 4 ✅ 已完成。Phase 5 远期。
> **范围**：把 `/agent-control` 从"装备 UI 占位"演进为可调用 runtime——skill 真能调外部 API、agent 真能编排 skill。
>
> **运行时 pattern 参考**：本文档是历史规划。日常实战看 [docs/canonical-dags/](./canonical-dags/) (3 个最小可运行 DAG 示例) + [docs/pipeline-input-pattern.md](./pipeline-input-pattern.md) (IO 放哪里规则) + [docs/smoke-checklist.md](./smoke-checklist.md) (出问题怎么定位)。INTERNAL handler 已于 2026-05-11 退场，下面 Phase 1-5 中关于 INTERNAL 的描述仅作历史保留。

---

## 0. 设计初心（一句话）

**几种"调用类型"写主程序里 + 每个具体能力存数据库** —— 配置驱动 + 通用 handler，不走 ZIP 上传。

```
            UI 操作就够 ←─────────────────→ 必须改代码 + 部署
            (DB 一行)                       (仓库 + PR)
  ┌─────────┬──────────┬──────────┬──────────┬────────────┐
  │HTTP_API │LLM_PROMPT│MCP_SERVER│INTERNAL  │ 新 handler │
  │ skill   │ skill    │ skill    │ skill    │  类型      │
  └─────────┴──────────┴──────────┴──────────┴────────────┘
        ★ 95% 的需求 ★              ↑           ↑
                                 少数情况    一年几次
```

---

## 1. 调用栈（三层）

```
        上游模块输入（"生成一个 3D 模型"）
                    ↓
        ┌──────────────────────────────┐
        │  Backbone or Orchestrator    │   ← 编排器：决定调谁/什么顺序
        │  (中央槽 Json 配置)          │
        └──────────────────────────────┘
              ↓     ↓     ↓
        ┌────────┐ ┌────────┐ ┌────────┐
        │ skill1 │ │ skill2 │ │ skill3 │   ← 6 个装备槽
        └────────┘ └────────┘ └────────┘
              ↓
        ┌──────────────────────────────┐
        │  Handler (HTTP_API / LLM ...)│   ← 单次调用执行器
        └──────────────────────────────┘
                    ↓
        Meshy API / Anthropic API / OpenAI API / MCP server
```

**类比**：handler = 墙上的插座类型，skill = 一台具体电器，agent = 房间，编排器 = 房间里的智能管家或自动定时器。

---

## 2. 已拍板的设计决定（2026-05-07）

| # | 决定 | 备注 |
|---|---|---|
| 1 | Backbone MVP = **线性步骤** + simple inputMapping | 不上 react-flow DAG，留 Phase 5+ |
| 2 | Orchestrator provider = **Anthropic + OpenAI 都支持** | 第一版双引擎，secret 都已就绪 |
| 3 | 新起 `AgentJob` 表（不复用 RelicProcessingJob） | 字段差异大，避免耦合 |
| 4 | 保留 `Skill.kind`（PASSIVE/ACTIVE/ULTIMATE） | 装饰用，不引入 runtime 语义 |

---

## 3. 数据模型扩展

### 3.1 `Skill` 表新增字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `handlerKind` | enum `HandlerKind` | `HTTP_API` / `LLM_PROMPT` / `MCP_SERVER` / `INTERNAL` |
| `handlerConfig` | `Json` | 该 handler 需要的参数（URL / authEnv / 模板...） |
| `inputSchema` | `Json?` | JSON Schema, 校验输入 |
| `outputSchema` | `Json?` | JSON Schema, 校验输出 |

`HandlerKind` enum 落地为 Prisma enum。

### 3.2 `AgentJob` 表（新建）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | cuid | PK |
| `agentId` | FK → Agent | |
| `mode` | enum `AgentMode` | 快照执行时 agent 的 mode |
| `input` | Json | 入参 |
| `output` | Json? | 终态产物 |
| `status` | enum (PENDING/RUNNING/SUCCESS/FAILED) | |
| `errorMessage` | String? | |
| `runLog` | Json | 每步 input/output/duration/error 的数组 |
| `attempts` / `maxAttempts` | Int | 重试 |
| `startedAt` / `endedAt` / `createdAt` / `updatedAt` | DateTime | |

索引：`(status, updatedAt)`、`(agentId, createdAt desc)`。

### 3.3 中央槽 Json shape

**`Agent.pipelineConfig`（MECHANICAL）**：
```json
{
  "version": 1,
  "steps": [
    { "id": "s1", "slotIndex": 0, "inputMapping": { "from": "agent.input" } },
    { "id": "s2", "slotIndex": 2, "inputMapping": { "from": "s1.output" } }
  ]
}
```

> `slotIndex` 而非 `skillId`：换装时 pipeline 不会 dangling。

**`Agent.dispatcherConfig`（AUTONOMOUS）**：
```json
{
  "version": 1,
  "provider": "anthropic" | "openai",
  "model": "claude-opus-4-7" | "gpt-4o" | ...,
  "systemPrompt": "...",
  "maxIterations": 10,
  "temperature": 1.0,
  "stopWhen": "no_tool_use"
}
```

---

## 4. 代码组织

```
lib/skills/
  handlers/
    httpApi.ts          ─ Phase 1
    llmPrompt.ts        ─ Phase 1
    mcpServer.ts        ─ Phase 5（占位）
    internal/
      index.ts          ─ INTERNAL slug → 函数 映射
  registry.ts           ─ HandlerKind → handler
  invoke.ts             ─ 单次调用入口（含 input/output schema 校验）
  runtime/
    backbone.ts         ─ Phase 3（线性步骤 executor）
    orchestrator.ts     ─ Phase 4（LLM tool-use loop，Anthropic + OpenAI）
    runner.ts           ─ Phase 2（fire-and-forget AgentJob runner，参考 lib/relics/pipeline）

prisma/
  migrate-skill-handlers.ts   ─ Phase 1（4 字段 backfill + enum 创建）
  migrate-agent-jobs.ts       ─ Phase 2（新表 + 索引）
```

---

## 5. API 路由

| 路由 | 状态 | Phase |
|---|---|---|
| `POST/PATCH /api/skills[/:id]` | 扩展（接新字段） | 1 |
| `POST /api/skills/[id]/test-invoke` | 新增（admin-only，同步） | 1 |
| `PUT /api/agents/[id]/pipeline` | 已有，加 schema 校验 | 3 |
| `PUT /api/agents/[id]/dispatcher` | 已有，加 schema 校验 | 4 |
| `POST /api/agents/[id]/invoke` | 新增（异步，建 AgentJob） | 2 |
| `GET /api/agents/[id]/jobs` | 新增 | 2 |
| `GET /api/agents/[id]/jobs/[jobId]` | 新增（前端 3s 轮询） | 2 |
| `POST /api/agents/[id]/jobs/[jobId]/retry` | 新增 | 2 |
| `POST /api/agents/[id]/dry-run` | 新增（同步短超时，编辑器 Test Run 用） | 3/4 |

---

## 6. UI 改动

| 组件 | 改法 | Phase |
|---|---|---|
| [`SkillEditor.tsx`](../app/agent-control/components/SkillEditor.tsx) | 加 `handlerKind` 下拉 + 按 kind 切换的 config 表单 + Test Invoke 区 | 1 |
| [`SkillLibrary.tsx`](../app/agent-control/components/SkillLibrary.tsx) | 列表里展示 handlerKind badge | 1 |
| [`ControlConfigModal.tsx`](../app/agent-control/components/ControlConfigModal.tsx) | 拆分为 `BackboneEditor.tsx` (MECHANICAL) + `OrchestratorEditor.tsx` (AUTONOMOUS) | 3 / 4 |
| `BackboneEditor.tsx`（新） | 步骤列表（拖拽排序） + inputMapping 选择器 + Test Run | 3 |
| `OrchestratorEditor.tsx`（新） | model 选择 (anthropic/openai 切换) + systemPrompt + 工具预览 + Test Run | 4 |
| `AgentJobDrawer.tsx`（新） | 历史 + 详情 + 每步 trace（参考 RelicProcessingBanner） | 2 |

---

## 7. 安全约束（落地时务必遵守）

1. **Secret 永远进 env**：`handlerConfig.authEnv` 只存"读哪个 env name"。validator 拒绝任何看起来像明文 key 的字段。
2. **rate limit**：`handlerConfig` 留 `rateLimit: { perMin, perDay }` 可选字段。Phase 2 invoke 层在调用 handler 前强制（参考 [`/api/vault/unseal`](../app/api/vault/unseal/route.ts) 的内存 Map 模式）。
3. **错误脱敏**：handler 抛错时只记 `console.error("[skill:invoke] ...", e)`，response 给用户通用 "invoke failed" + jobId。绝不回传 e.message（可能含 API key 片段）。
4. **新加 INTERNAL handler 必须 commit**：不允许通过任何接口注入可执行代码。
5. **outputSchema 校验失败 ≠ handler 失败**：分两个错误码（`HANDLER_ERROR` vs `OUTPUT_SCHEMA_VIOLATION`），便于排查。

---

## 8. 实施顺序（Phase 1–5）

| Phase | 内容 | 验收点 | 状态 |
|---|---|---|---|
| **1** | Skill handlerKind 4 字段 + HTTP_API & LLM_PROMPT handler + SkillEditor 扩展 + Test Invoke | 在 UI 创建一条 Meshy skill，点 Test Invoke 拿到 3D 模型 URL | ✅ 完成 |
| **2** | AgentJob 表 + 异步 runtime 骨架 + crash recovery + Drawer | POST invoke 拿到 jobId，轮询拿到 status | ✅ 完成 |
| **3** | BackboneEditor + DAG executor (线性 MVP) + dry-run API | MECHANICAL agent 串 3 步 skill 跑通 | ✅ 完成 |
| **4** | OrchestratorEditor + LLM tool-use loop（Anthropic + OpenAI） | AUTONOMOUS agent 让模型自己决定调 skill | ✅ 完成 |
| **5（远期）** | MCP_SERVER handler / 可视化 DAG / status healthcheck-driven | 各自独立 epic | 待规划 |

---

## 9. Phase 1 拆解（当前进行中）

1. **Schema 改动**：`prisma/schema.prisma` 加 `HandlerKind` enum + Skill 4 字段。
2. **Migrate 脚本**：`prisma/migrate-skill-handlers.ts` 幂等 backfill：现有 skill `handlerKind = INTERNAL` + `handlerConfig = '{}'::jsonb` + `status = OFFLINE`。挂到 [`package.json`](../package.json) `npm start` 链上。
3. **Handler 实现**：
   - `lib/skills/handlers/httpApi.ts`：fetch + auth header 注入（从 `process.env[authEnv]`）+ body 模板 `{{var}}` 替换 + JSON 响应解析
   - `lib/skills/handlers/llmPrompt.ts`：Anthropic SDK + prompt template 渲染（先 Anthropic，OpenAI 留 Phase 4）
4. **Registry + invoke**：
   - `lib/skills/registry.ts`：HandlerKind → handler 函数映射
   - `lib/skills/invoke.ts`：`invokeSkill(skill, input)` → input schema 校验 → handler → output schema 校验 → 返回
5. **Validator 扩展**：`lib/validators.ts` `skillCreateSchema` 加 4 字段；`handlerConfig` 用判别联合按 handlerKind 校验细节字段。
6. **API**：
   - `POST/PATCH /api/skills[/:id]`：接新字段
   - `POST /api/skills/[id]/test-invoke`：admin-only，body `{ input }`，返回 `{ ok, output, errors }`
7. **UI**：
   - `SkillEditor.tsx` 加 handlerKind 选择器 + 分支表单 + Test Invoke 区
   - 沿用 ThemedDropdown 模式，不要原生 `<select>`
8. **验收**：`npm run type-check && npm run lint`（build 留 Phase 1 全部完成后单独跑）。

---

## 10. 后续 Phase 大纲（粗略）

### Phase 2 — AgentJob 异步基础设施
- 新表 + crash recovery（参考 [`lib/server-init.ts`](../lib/server-init.ts) `ensureServerInit()` 模式）
- `lib/skills/runtime/runner.ts` fire-and-forget + 退避重试（参考 `lib/relics/pipeline/runner.ts`）
- 4 个 API + `AgentJobDrawer.tsx`

### Phase 3 — Backbone (MECHANICAL)
- `lib/skills/runtime/backbone.ts` 线性 executor
- `BackboneEditor.tsx` 替换 `ControlConfigModal` MECHANICAL 分支
- Test Run = `POST /api/agents/[id]/dry-run`

### Phase 4 — Orchestrator (AUTONOMOUS)
- `lib/skills/runtime/orchestrator.ts`：Anthropic + OpenAI 双引擎，统一抽象
- 把装备 skills 转 tool defs（用 inputSchema）
- `OrchestratorEditor.tsx` 替换 `ControlConfigModal` AUTONOMOUS 分支
- 注意 model 列表写在前端常量，跟 provider 联动

### Phase 5 — 远期
- MCP_SERVER handler（参考 [Anthropic MCP](https://github.com/modelcontextprotocol)）
- DAG 可视化（react-flow），从线性升级为图
- Skill status 由 healthcheck 后台服务自动维护（`Skill.status` 当前的人工 toggle 退役）
- Skill audit 表（参考 [`CLAUDE.md`](../CLAUDE.md) "级联删除无审计"段，提前补这个洞）

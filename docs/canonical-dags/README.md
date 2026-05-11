# Canonical DAG Examples

这里是 3 个**最小可运行**的 backbone DAG 示例，配套 `.agent.json` envelope (与 `GET /api/agents/[id]/export` 同 shape)，admin 在 `/agent-control?tab=agents` footer 点 **Import ↑** 选对应 JSON 即可导入试玩。

| # | 示例 | 学什么 | 节点 |
|---|------|--------|------|
| 01 | [single-skill](./01-single-skill.md) | agent.input 怎么进、leaf output 怎么出 | 1 skill |
| 02 | [branch-flow](./02-branch-flow.md) | 按 agent.input 字段分流到不同 leaf | 1 branch + 1 skill + 1 transform |
| 03 | [foreach-pick](./03-foreach-pick.md) | per-item 处理 + 聚合 + 排序 pick | 2 transform + 1 forEach |

每个示例都遵循统一的命名规范 (见下)，相互独立可以单独导入。学完直接在 roster 里删掉，**不要 deploy**。

---

## 如何试玩

1. `npm run dev`，admin 登录。
2. `/agent-control?tab=agents` → 滚到 roster 底部 → **Import ↑** → 选对应 `.agent.json`。
3. 默认 codename 没冲突会直接导入；如冲突会弹 409，输个 `newCodename` (如 `EXAMPLE-01-ECHO-2`) 再来一次。
4. 打开新 agent → 中央 Backbone 节点 → 编辑器右栏 **Test Run** → 喂示例 input → 看 `output` + `runLog`。
5. 三个示例验证完后删掉 agent (`/agent-control?tab=agents` → agent 详情 → 删除按钮)。

**不要 deploy**——这些 agent 没有 SceneBinding 指向它们，deployed 也不会被生产路径调用，但保留在 roster 里会污染列表。

---

## 节点命名规范 (canonical)

节点 id 是 **agent 内部**事——admin 可以随便改，不会破任何对外契约。命名规范纯粹是 readability + 团队约定。

**真正的对外契约**在另一个层面：

- agent **末尾 leaf 节点的 output shape** 必须匹配 [`lib/relics/scenes.ts`](../../lib/relics/scenes.ts) 中对应 scene 的 `outputSchema` (Zod) — 字段名、类型、regex / enum / length 全是硬约束。
- Runtime 强制：[`lib/agent-service/dispatch.ts`](../../lib/agent-service/dispatch.ts) (sync 路径) 和 [`lib/skills/runtime/runner.ts`](../../lib/skills/runtime/runner.ts) (async 路径) 在 leaf 输出后 `safeParse`，不匹配返回 `SCENE_OUTPUT_INVALID` 并阻断 `_relicWriteback` hook。
- 想换 agent / 重构 DAG？只要保证末尾 leaf 仍产匹配 outputSchema 的字段，agent 内部 (节点 id / 连线 / 中间塑形) 随便改。
- 注：旧的 `SceneBinding.outputMap` 字段已于 2026-05-11 退场——契约从 DB 层下沉到代码层 (Zod) 后，再用 outputMap 在 DB 里 reshape 就是双重事实源，所以删了。

下面这些是命名约定 (不强制、不影响 runtime)：

### node id (kebab-case)

- **skill 节点**：动词短语，描述这一步在干啥。`fetch-product-info` / `cutout-image` / `score-candidates` / `download-binary`
- **transform 节点**：按用途分前缀
  - `shape-*` —— 整形重命名 (e.g. `shape-search-results`)
  - `build-*` —— 从零构造对象 (e.g. `build-loop-init`)
  - `pick-*` —— 选取/排序 (e.g. `pick-best-candidate`)
  - `filter-*` —— 过滤数组 (e.g. `filter-watermarked`)
  - `merge-*` —— 多源合并 (e.g. `merge-iter-state`)
- **branch 节点**：按字段名命名 `branch-by-<field>`，如 `branch-by-mode`、`branch-by-use-user-image`
- **loop 节点**：`loop-<目的>`，如 `loop-refine-query`
- **forEach 节点**：`for-each-<item>`，如 `for-each-candidate`、`for-each-download`

### 字段约定 (output payload)

| 用途 | 字段名 |
|---|---|
| 从二进制下载/网络抓取出来的字节 | `downloadBase64` / `downloadContentType` / `downloadBytes` |
| 保存到 `/api/internal/save-asset` 后返回的相对路径 | `savedPath` / `absPath` |
| **触发 runner 写回 Relic 列的契约 payload** | `_relicWriteback: { id, fields }` — 字段名走 [`ALLOWED_WRITEBACK_FIELDS` allowlist](../../lib/skills/runtime/runner.ts)。本目录所有示例**不依赖** `_relicWriteback`，纯演示 DAG 流；relic 回写另起篇章。 |

### inputFrom source-ref 速查

```
"agent.input"                  // 顶层 agent input (传入 DAG 的整个 ctx)
"agent.input.foo"              // 顶层 input 的 .foo 子字段
"<nodeId>.output"              // 某节点的整个 output
"<nodeId>.output.foo.bar"      // 某节点 output 的子路径
{ merge: { x: "agent.input.a", y: "stepA.output.b" } }   // 多源 merge 到一个对象
```

`merge` 的 value 只接受 source-ref **字符串**，不接受字面量——要塞常量进去得用一个上游 `transform` 节点产出。

### 反模式 (会被 validator / runtime 拒)

- ❌ `handlerConfig.apiKey: "sk-..."` (validator 拒；用 `authEnv: "MY_ENV"`)
- ❌ `transform.expression` 里写 fetch / fs / Date.now (transform 是纯 JSONata 沙盒，没这些 API)
- ❌ DAG depth > 2 的 loop / forEach 嵌套 (`MAX_LOOP_DEPTH = 2`)
- ❌ 节点 id 用 PascalCase 或带空格 (validator 要求 `[a-zA-Z0-9_-]+`，但本仓库**约定**统一 kebab-case)

---

## 相关参考

- DAG runtime + schema：[`lib/skills/runtime/backbone.ts`](../../lib/skills/runtime/backbone.ts) / [`lib/validators.ts`](../../lib/validators.ts) `pipelineConfigV2Schema`
- 生产 forge：`prisma/migrate-{picker,cutout,lore,meshy}-forge.ts`
- pipeline-input pattern (agent.input 怎么被预填)：[`docs/pipeline-input-pattern.md`](../pipeline-input-pattern.md)
- 冒烟清单：[`docs/smoke-checklist.md`](../smoke-checklist.md)

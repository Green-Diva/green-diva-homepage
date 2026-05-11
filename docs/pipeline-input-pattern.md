# Pipeline-Input Pattern

> **规则**：scene 的 `ctx` 必须是纯 JSON-serializable。**所有 FS / Prisma / 大 blob 解码 / 网络抓取在调 `dispatchScene` / `callScene` 之前完成**，由 pipeline / endpoint 层的 helper 函数预填。Agent DAG 只编排 HTTP + LLM。

这是 INTERNAL handler 退场 (2026-05-11) 之后填进去的设计核心。一旦 agent DAG 里的 LLM_PROMPT skill 偷塞 fs 调用或 Prisma 查询，整套架构就破了——HTTP_API / LLM_PROMPT / transform 是 stateless declarative 配置，**不能**也**不应该**接触主进程的运行时资源。

---

## 为什么这条规则存在

| Reason | 解释 |
|---|---|
| **可序列化** | DAG 配置存在 DB JSON 里、可 export/import、可在编辑器画布上展示。FS path / Prisma client 不可序列化。 |
| **可测试** | scene `sample-run` (B.3) / agent `dry-run` (B.2) / skill `test-invoke` 全部期望纯 JSON 输入。helper 在 pipeline 层 = 单元测试可以直接喂 mock。 |
| **runtime 沙盒** | transform 节点是纯 JSONata，**没有** fs / fetch / Date.now API；validator 会 parse-once 拒不合法表达式。 |
| **避免 INTERNAL 复活** | 旧 INTERNAL handler 把"查 DB + 扫文件夹 + 拼字符串 + 塑形 LLM 输入"压成单点。退役它的代价是把这些 IO **明确**留到 pipeline 层 helper，不允许偷塞回 skill。 |

---

## 现有 helper 索引

| Helper | 文件 | Signature | 用途 |
|---|---|---|---|
| `scanWorkspace` | [`lib/relics/pipeline/scanWorkspace.ts`](../lib/relics/pipeline/scanWorkspace.ts) | `(workspaceSlug: string) → Promise<{ userBrief, fileSummary, imageAbsPaths, textExcerpts }>` | 扫 `private/relics/<slug>/source/extracted/`，抽用户输入 + 文件清单 + 文本片段。 |
| `stageUserCandidates` | [`lib/relics/pipeline/stageUserCandidates.ts`](../lib/relics/pipeline/stageUserCandidates.ts) | `(workspaceSlug, imageAbsPaths) → Promise<{ userCandidates, referenceImageAbs }>` | 把用户上传图 probe 尺寸 + copy 到 derived/，产 PICKER-FORGE 入参。 |
| `readRelicImageAsDataUri` | [`lib/relics/readImageAsDataUri.ts`](../lib/relics/readImageAsDataUri.ts) | `(relativePath, { maxBytes? }) → Promise<{ dataUri, contentType, bytes }>` | 把 Relic 资产路径解码成 data URI，给 CUTOUT / MESHY 的 fal/meshy 调用。 |

**调用点**：

```
lib/relics/pipeline/steps/generateMetadata.ts:241    scanWorkspace + stageUserCandidates
app/api/relics/[id]/enhance-2d/route.ts:46           readRelicImageAsDataUri
app/api/relics/[id]/create-3d/route.ts:83            readRelicImageAsDataUri
```

---

## 命名约定

helper 命名前缀 **`prepX(...)` 或 `scanX/stageX/readX(...)`**，返回值的**字段名 = agent.input 字段名**——这样 `SceneBinding.inputMap` 写 `{{ctx.userBrief}}` 就能直接命中，inputMap 里**不需要**任何转换语法。

举例 (generateMetadata.ts:241-259)：

```ts
const scan = await scanWorkspace(workspaceSlug);
const staged = await stageUserCandidates(workspaceSlug, scan.imageAbsPaths);

const result = await callScene(
  "relic.draft-metadata",
  {
    workspaceSlug,
    userBrief: scan.userBrief,         // scan.* 字段直通 ctx
    fileSummary: scan.fileSummary,
    imageAbsPaths: scan.imageAbsPaths,
    textExcerpts: scan.textExcerpts,
    userCandidates: staged.userCandidates,
    referenceImageAbs: staged.referenceImageAbs,
  },
);
```

SceneBinding.inputMap 对应：

```js
{
  workspaceSlug:     "{{ctx.workspaceSlug}}",
  userBrief:         "{{ctx.userBrief}}",
  fileSummary:       "{{ctx.fileSummary}}",
  imageAbsPaths:     "{{ctx.imageAbsPaths}}",
  textExcerpts:      "{{ctx.textExcerpts}}",
  userCandidates:    "{{ctx.userCandidates}}",
  referenceImageAbs: "{{ctx.referenceImageAbs}}",
}
```

字段名对齐 = inputMap 退化为直传 = admin 编 SceneBinding 不需要重新发明字段名。

---

## 何时该加新 helper / 何时不该

**该加 helper**：

- fan-in 多个文件 / 目录扫描 → `scanX` 模式
- 解码二进制 (PNG → base64 data URI) → `readX` 模式
- 查 DB 多张表拼对象 → `gatherX` 模式
- 网络抓取在 endpoint 阶段就完成 (e.g. 调外部 API 拿初始 reference data) → `prepX` 模式

**不该加 helper** (直接放 ctx)：

- 单字段直读 (`relicId` / `userId` / `mode: "regen"`)
- 已经在调用栈上下文里的 primitive (URL search param、user session 字段)
- 任何只是字符串拼接 / 简单条件分支的逻辑

---

## 反模式清单 (会被审查 / runtime / validator 拒)

❌ **LLM_PROMPT skill 的 systemPrompt 里写 `{{file.readSync('...')}}`**
→ template 引擎不支持函数调用，会原样保留 `{{...}}` 出现在 prompt 里。

❌ **HTTP_API handlerConfig 引用 `process.env` 之外的运行时**
→ `handlerConfig` 是纯 JSON，没办法引用 Prisma client / fs / 任何模块。能用的只有 `{{var}}` 模板和 `authEnv: "NAME"`。

❌ **scene ctx 里直接塞整行 `relic: Relic`**
→ 大对象 + 序列化噪声 + 字段漂移 (Relic 多了一列 dispatch 就要修)。**只塞需要的字段**，并且字段名对齐 agent.input。

❌ **在 transform 节点表达式里写 `fetch()` / `Date.now()` / `process.env.X`**
→ JSONata 是纯沙盒，没这些。要时间戳？让 endpoint 在 ctx 里塞 `now: new Date().toISOString()`。要 env？让 endpoint 读出来塞 ctx。

❌ **新加 INTERNAL handler 来"处理一下 IO"**
→ INTERNAL 已退场，不要再加。复杂业务编排走 backbone 原语 (loop / forEach / transform)；IO 留 endpoint / pipeline。

---

## 自我检验

下次新加 scene 时问自己：

1. agent DAG 节点里有没有出现 `process.cwd()` / `path.join('private/...')` / `prisma.X.findMany`？→ 错。
2. SceneBinding.inputMap 里出现了模板函数调用 (e.g. `{{readFile(...)}}`)？→ 错。
3. ctx 字段名跟 agent.input 字段名一致吗？→ 不一致就改 helper 返回值字段名对齐，不要在 inputMap 里 rename。
4. 这个 IO 需要异步 + 失败重试吗？→ 那是 agent DAG 内 skill 的活 (HTTP_API 自带 retry)，不是 helper 的活。helper 只做一次性 ready-to-use 准备。

只要这 4 条全 pass，新 scene 就遵守了 pattern。

---

## 对偶规则：output 契约在哪

这篇文档讲**进入面** (agent.input 怎么被 pipeline 层预填)。对应的**产出面** = agent 末尾 leaf 的 output 必须匹配 [`lib/relics/scenes.ts`](../lib/relics/scenes.ts) 该 scene 的 `outputSchema` (Zod, 含 regex / enum / length 硬约束)。两边对称：

- **input**：FS / Prisma 在 pipeline 层 `prepX` helper → ctx → applyTemplate → agent.input
- **output**：agent 末尾 leaf 自塑形 (通常加一个 `transform` 节点) → runtime `safeParse(scene.outputSchema)` → SCENE_OUTPUT_INVALID 或继续

两个面都把"接触点"从 agent DAG 内部推到边界：**进入边界在 pipeline / endpoint 层；产出边界在代码层 Zod**。DAG 内部纯编排，不再有契约职责。

旧的 `SceneBinding.outputMap` 字段于 2026-05-11 退场，原因正是契约下沉到代码层后，DB 层的 reshape 就成了双重事实源。新加 scene 时**只**在 `lib/relics/scenes.ts` 声明 outputSchema，**不要**找其他地方再写一份。

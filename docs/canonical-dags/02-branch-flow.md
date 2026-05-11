# 02 — Branch Flow

按 `agent.input.mode` 分流到不同 leaf：一边走 skill (echo)，另一边走 transform (greeting)。

```
                      ┌── (mode = "echo")  ─→ [skill: echo-via-httpbin] ─→ leaf
agent.input ─→ [branch-by-mode] ─┤
                      └── (mode = "greet") ─→ [transform: build-greeting] ─→ leaf
```

## 做什么

演示 backbone branch 节点：从 input 读 `mode` 字段，路由到不同子图。被路由到的 leaf 输出就是 agent 的整体输出；**未命中** branch 的下游节点会被标 `skipped: true` 进 runLog (引用它输出的 merge 字段解析为 `null`)。

## 何时用这个 pattern

- agent 要在"创建模式 / 重生成模式" / "走快路径 / 走慢路径"之间切换 (LORE-FORGE 的 `mode` branch 就是这个形态，case = `initial` / `regen`)。
- 一边需要外部 IO (skill)，另一边只是数据塑形 (transform)——展示 branch 可以路由到**任意 5 种** node type，不限于 skill。

## 节点逐个解读

### `branch-by-mode` (branch node)

```json
{
  "id": "branch-by-mode",
  "type": "branch",
  "inputFrom": "agent.input",
  "cases": [
    { "path": "mode", "op": "eq", "value": "echo",  "label": "echo"  },
    { "path": "mode", "op": "eq", "value": "greet", "label": "greet" }
  ],
  "defaultLabel": "greet"
}
```

- `inputFrom: "agent.input"` —— branch 拿到整个 input，`path: "mode"` 读 `input.mode` 子字段。
- `cases[].label` —— edge 用 `when` 引用这个 label，决定走哪条出边。
- `defaultLabel: "greet"` —— input.mode 既不是 "echo" 也不是 "greet" 时兜底；不设就报 `BRANCH_NO_MATCH`。

### Edges (注意 `when` 字段)

```json
{ "from": "branch-by-mode", "to": "echo-via-httpbin", "when": "echo" }
{ "from": "branch-by-mode", "to": "build-greeting",   "when": "greet" }
```

只有从 branch 节点出去的边才需要 `when`。

### `echo-via-httpbin` (skill leaf)

跟示例 01 同款 skill (装在 slot 0)，inputFrom = `agent.input`。

### `build-greeting` (transform leaf)

```json
{
  "id": "build-greeting",
  "type": "transform",
  "inputFrom": "agent.input",
  "expression": "{ \"greeting\": 'Hello, ' & name }"
}
```

`expression` 是 JSONata：从 inputFrom-resolved 值 (即 `agent.input`) 读 `name` 字段，拼成 `{ greeting: "Hello, <name>" }`。

## 关键陷阱

1. **case `path` 是相对 inputFrom 的子路径**，不是绝对路径。如果 inputFrom = "agent.input.user" 则 path: "role" 读的是 `agent.input.user.role`。
2. **`defaultLabel` 强烈建议设**，不然喂个不在 case 列表里的值会让整个 DAG 直接 `BRANCH_NO_MATCH` 失败。
3. **跨分支引用**：被跳过的下游节点 output 解析为 `null` (不是 `undefined`、不是报错)；后续节点用 merge 拉它的字段，拿到 null 自己处理。
4. JSONata 字符串字面量用**单引号** (`'Hello, '`)，不是双引号——expression 整体是 JSON 字符串，里面双引号要转义。

## 怎么试运行

导入 [`02-branch-flow.agent.json`](./02-branch-flow.agent.json) → Test Run。

**走 echo 路径**:

```json
{ "mode": "echo", "message": "branched into echo" }
```

期望 output = httpbin 回显；runLog 里 `build-greeting` 标 `skipped`。

**走 greet 路径**:

```json
{ "mode": "greet", "name": "Diva" }
```

期望 output `{ "greeting": "Hello, Diva" }`；runLog 里 `echo-via-httpbin` 标 `skipped`。

**走 default (greet) 路径**：

```json
{ "mode": "unknown", "name": "Fallback" }
```

期望同 greet。

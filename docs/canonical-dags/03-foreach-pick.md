# 03 — forEach + Pick

per-item 处理 + 聚合 + 排序选最佳，全部用 transform / forEach 原语，不依赖任何 skill / 外部 API。

```
agent.input.items ─→ [forEach for-each-stamp] ─→ [transform pick-best] ─→ leaf
                       │ (body, runs per item)
                       │   agent.input = { item, index, total }
                       └─→ [transform stamp-item] ─→ leaf (per-iter)
```

## 做什么

agent.input 传入一个 items 数组。forEach 对每一项跑 body 子图——body 只有一个 transform，把 item 重新塑形 + 注入 index/timestamp 字段；forEach 默认 aggregate 是 `concat-array`，所以最终 forEach.output 是塑形后的对象数组。下游 transform `pick-best` 用 JSONata 按 score 降序，取第一个。

这是 PICKER-FORGE 的**极简骨架**——picker 真实流程是 `search → forEach{download + save + transform} → vision-filter → loop refine`，剥掉 loop / vision / 真实 IO 后就剩这个形状。

## 何时用这个 pattern

- 输入是一组 N 个候选 (图片 URL / 商品 SKU / 候选答案 ...)，需要对每个独立处理 (下载 / 调 LLM / 转码) 然后从结果里选最优。
- per-item 处理不需要跨项目共享状态——如果需要"看完所有再决定"(e.g. vision-filter 输入是全部 N 张图)，就要用 `prep-vision` transform 把 forEach.output 整体重新拼装，再喂给下一个 skill (picker-forge 就是这么做)。

## 节点逐个解读

### `for-each-stamp` (forEach node)

```json
{
  "id": "for-each-stamp",
  "type": "forEach",
  "inputFrom": "agent.input.items",
  "maxItems": 10,
  "body": { "nodes": [...], "edges": [] },
  "aggregate": "concat-array"
}
```

- `inputFrom: "agent.input.items"` —— 子路径取数组。forEach 要求 inputFrom 解析到**数组**，不是对象。
- `maxItems: 10` —— 上限保护，超过截断 (示例数据≤3 项)。
- `body` —— 自包含 sub-DAG，每次迭代独立 topo 排序、独立 source-ref 作用域。
- `aggregate: "concat-array"` —— forEach 默认值，把每次 iter 的 leaf output 串成数组。另一种 `last` 只取最后一次。

### body: `stamp-item` (transform)

```json
{
  "id": "stamp-item",
  "type": "transform",
  "inputFrom": "agent.input",
  "expression": "{ \"name\": item.name, \"score\": item.score, \"index\": index, \"total\": total }"
}
```

**关键**：body 节点的 `agent.input` 不是顶层 input，而是 forEach 注入的**每次 iter 的 envelope** `{ item, index, total }`。所以这里 `item.name` / `item.score` 读的是当前迭代项的字段，`index` / `total` 直接可用。

### `pick-best` (transform leaf)

```json
{
  "id": "pick-best",
  "type": "transform",
  "inputFrom": "for-each-stamp.output",
  "expression": "($items := $; { \"winner\": ($items^(>score))[0], \"considered\": $count($items) })"
}
```

- `inputFrom: "for-each-stamp.output"` —— forEach 的整体输出 = concat 后的数组。
- JSONata `^(>score)` 是按 `score` **降序**排序 (`<score` 是升序)。
- `($items := $; ...)` 是 JSONata 变量绑定：JSONata 变量名**必须** `$` 前缀 (`$items` 不是 `items`)。先把当前值 (`$` = inputFrom 解析后的整个数组) 绑到 `$items`，然后用块表达式产出最终 `{ winner, considered }`。

## 关键陷阱

1. **forEach inputFrom 必须解析到 array**——给个对象会立刻报错。如果你的数据藏在嵌套字段里，先用一个上游 transform 拆出来 (`{ items: results.list }` → 然后 `inputFrom: "shape-X.output.items"`)。
2. **body 里 `agent.input` 是 iter envelope**，不是顶层。要拿顶层值得在 forEach **外面**先 transform 出来，然后在 body 用 `inputFrom: "shape-Outer.output"` 显式引用——picker-forge 就是这么传 `workspaceSlug` 进 forEach body 的 (它把 `workspaceSlug` 拷到每个 item 上，让 item.workspaceSlug 可见)。
3. **JSONata 块表达式分号要小心**：JSONata 用 `;` 串多个语句，外层用括号包起来 (`(stmt1; stmt2; stmt3)`)。
4. **嵌套深度限制**：loop / forEach 共享 `MAX_LOOP_DEPTH = 2` 预算。本例只 1 层 forEach，无问题。

## 怎么试运行

导入 [`03-foreach-pick.agent.json`](./03-foreach-pick.agent.json) → Test Run。

Input：

```json
{
  "items": [
    { "name": "Alpha",   "score": 42 },
    { "name": "Bravo",   "score": 99 },
    { "name": "Charlie", "score": 17 }
  ]
}
```

期望 output：

```json
{
  "winner": { "name": "Bravo", "score": 99, "index": 1, "total": 3 },
  "considered": 3
}
```

`runLog` 里能看到 `for-each-stamp` 下面有 3 个子 step (`for-each-stamp#iter0/stamp-item` 等)，每个含对应 item 的 output。

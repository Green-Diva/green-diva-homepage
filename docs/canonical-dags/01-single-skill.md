# 01 — Single Skill

最小可运行 DAG：1 个 HTTP_API skill，1 个节点。

```
agent.input ─→ [skill: echo-via-httpbin] ─→ leaf output
```

## 做什么

把 `agent.input` 整体传给一个 HTTP_API skill，让它 POST 到 `https://httpbin.org/anything`，httpbin 把请求回显成 JSON。leaf output = 整个 httpbin 响应。

## 何时用这个 pattern

- agent DAG 只是给一个 skill 加 "scene → 路由 → input 模板" 的薄壳 (绝大多数早期 forge 都是这个形态，e.g. CUTOUT-FORGE 是 single-skill+save 两步)。
- 你想理解 `inputFrom: "agent.input"` 怎么把整个 ctx 塞进 skill 的 `handlerConfig` 模板 (`{{var}}` 引用)。

## 节点逐个解读

### `echo-via-httpbin` (skill node)

```json
{
  "id": "echo-via-httpbin",
  "type": "skill",
  "slotIndex": 0,
  "inputFrom": "agent.input"
}
```

- `slotIndex: 0` —— DAG 不直接持有 skillId；它说"用装备到 slot 0 的那个 skill"。这样换装时 DAG 不会 dangling。
- `inputFrom: "agent.input"` —— 把外部传进来的整个 ctx 作为 skill 的 input。
- skill 的 `handlerConfig.bodyTemplate` 用 `{{message}}` 引用 input 上的 `message` 字段，HTTP_API handler 在调用前完成模板替换。

## 关键陷阱

1. **`{{xxx}}` 模板只在 handlerConfig 里有效**——不是 inputFrom。inputFrom 是 source-ref 路径，不接受 `{{...}}`。
2. httpbin POST 的响应是 `{ args, data, files, form, headers, json, url, ... }`——你的 `message` 在 `response.json.message`。
3. handlerConfig 不能含明文 key——这个示例不用鉴权，所以没问题。如果换成需要鉴权的 endpoint，必须 `authEnv: "MY_ENV_NAME"`，validator 拒明文。

## 怎么试运行

1. 导入 [`01-single-skill.agent.json`](./01-single-skill.agent.json)。
2. 打开新 agent → 中央 Backbone 节点 → 右栏 **Test Run**。
3. Input JSON：

   ```json
   { "message": "hello from canonical example 01" }
   ```

4. 期望 output：httpbin 回显，其中 `json.message === "hello from canonical example 01"`。
5. `runLog` 里应该看到 1 个 step：`echo-via-httpbin` status=ok，duration < 2s。

需要外网访问 `httpbin.org`。失败先去 [`docs/smoke-checklist.md`](../smoke-checklist.md) step 2 排查。

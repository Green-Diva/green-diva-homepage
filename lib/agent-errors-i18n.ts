// Diagnostic hints (zh-CN) keyed by AgentErrorCode.
//
// Rendered by AgentJobDrawer below the raw errorMessage to tell admin
// what the code likely means + where to look next. Keep hints short
// (one sentence, < ~80 chars) and action-oriented — "去 X 检查 Y" beats
// "Y is broken".
//
// Why a separate map (not inline in the enum file): admin-facing copy
// changes more often than the code list itself; isolating it keeps the
// enum module dependency-free and easy to grep.

import type { AgentErrorCode } from "@/lib/agent-errors";

export const DIAGNOSTIC_HINTS_ZH: Record<AgentErrorCode, string> = {
  // Pipeline / Dispatcher config
  PIPELINE_MISSING: "Agent 没有 pipelineConfig，去 BackboneFlowEditor 配置 DAG 后再 deploy。",
  PIPELINE_INVALID: "pipelineConfig 结构不合法，看 errorMessage 里的字段路径，在 BackboneFlowEditor 修。",
  PIPELINE_VERSION: "pipelineConfig.version 不支持，导出再导入会自动升级到 v2。",
  PIPELINE_DEAD_END: "DAG 跑到无出边节点但没产出最终输出，补一条 edge 把末尾接上。",
  DISPATCHER_MISSING: "Agent 没有 dispatcherConfig，去 OrchestratorEditor 配置模型 / prompt 后 deploy。",
  DISPATCHER_INVALID: "dispatcherConfig 结构不合法,看 errorMessage 里的字段路径。",
  DISPATCHER_VERSION: "dispatcherConfig.version 不支持。",

  // DAG nodes
  SLOT_EMPTY: "DAG 引用的槽位没装备 skill,去 /agent-control 给该 agent 装配技能后重试。",
  SKILL_OFFLINE: "skill 当前 OFFLINE,去 SkillLibrary 把 status 切回 ONLINE。",
  BRANCH_NO_MATCH: "branch 节点所有 case 都没命中且无 default,补 defaultLabel 或调整 cases。",
  BRANCH_NO_EDGE: "branch 命中的 label 没有对应出边,在画布上把 branch 出边连到目标节点。",
  LOOP_TOO_DEEP: "loop / forEach 嵌套超过 MAX_LOOP_DEPTH=2,把内层拍平。",
  FOREACH_INPUT_NOT_ARRAY: "forEach 节点的 inputFrom 解析出非数组,检查上游 transform 的输出形状。",
  TRANSFORM_FAILED: "transform 节点 JSONata 表达式求值失败,看 errorMessage 定位语法 / 引用错误。",
  PERSIST_INPUT_INVALID: "persist 节点入参不合法,检查 inputFrom 是否解析出 { relicSlug, kind, base64, contentType? }。",
  PERSIST_FAILED: "persist 节点写盘失败,通常是磁盘权限或路径越界,看 errorMessage。",

  // Orchestrator
  NO_TOOLS: "Orchestrator 找不到可暴露的 ONLINE skill,先装配并 ONLINE 至少一条 skill。",
  UNKNOWN_TOOL: "LLM 调用了不存在的 tool 名,通常是 prompt 与 skill 装备不同步。",
  OUTPUT_NOT_JSON: "outputMode=json 但 LLM 末段文本不是 JSON(不以 { 或 [ 开头),检查 systemPrompt 是否清晰描述了输出格式。",
  OUTPUT_PARSE_FAILED: "outputMode=json 且文本像 JSON 但 parse 失败,通常是 LLM 加了 markdown 围栏或漏闭合括号。",

  // Handler
  MISSING_ENV: "服务端缺对应 env 变量(GEMINI_API_KEY / FAL_API_KEY / MESHY_API_KEY 等),检查 .env。",
  INVALID_CONFIG: "skill 的 handlerConfig 字段缺失或形状不对,去 SkillLibrary 编辑 skill。",
  HTTP_ERROR: "外部 HTTP 上游返回非 2xx,看 errorMessage 里的 status / url。",
  TIMEOUT: "请求超时,可能是上游慢或网络抖动,retry 一次。",
  OUTPUT_PARSE: "上游返回内容解析失败(JSON / responseTransform),检查 skill 的 responseTransform 表达式。",
  PROVIDER_ERROR: "LLM provider 调用失败(429 / 5xx / 内容策略),检查 quota 和 prompt。",
  HANDLER_ERROR: "handler 内部未分类异常,看 errorMessage / runLog 定位。",

  // Skill invoke
  INPUT_SCHEMA_VIOLATION: "skill input 不符 inputSchema,检查上游节点输出 / inputMap 模板。",
  OUTPUT_SCHEMA_VIOLATION: "skill output 不符 outputSchema,检查 handler responseTransform。",

  // Runner / scene
  AGENT_RUNTIME_ERROR: "Agent 执行整体失败,展开 runLog 看哪一步先红的。",
  SCENE_OUTPUT_INVALID: "Agent 末尾 leaf 输出不符 scene contract,去 BackboneFlowEditor 检查 transform 节点塑形。",
  RUNNER_CRASH: "Runner 抛出未捕获异常,通常是 bug;把 runLog 截图给开发。",
  UNKNOWN_SCENE: "scene key 没在代码层注册,确认 lib/scenes-init.ts 有 import 对应模块的 scenes.ts。",
  UNBOUND_SCENE: "scene 没有 SceneBinding,去 /agent-control?tab=scenes 创建绑定。",
  BINDING_DISABLED: "SceneBinding.enabled = false,去 SceneBindingEditor 启用。",
  AGENT_MISSING: "SceneBinding 引用的 agent 不存在(可能被删),重新选 agent。",
  AGENT_NOT_DEPLOYED: "Agent 还是草稿(deployedAt=null),先 deploy 再调。",
  CONTEXT_INVALID: "callScene / dispatchScene 的 ctx 不符 scene contextSchema,检查调用点。",
  TEMPLATE_ERROR: "inputMap 模板渲染失败,检查 {{ctx.X}} / {{actor.X}} 引用是否存在。",
  DISPATCH_FAILED: "scene 分发整体失败,看 errorMessage 定位。",

  // API
  AUTH_REQUIRED: "未登录或 session 已过期,先登录。",
  AUTH_FORBIDDEN: "登录了但权限不够(需要 admin),换账户。",
  VALIDATION_FAILED: "请求体不符 schema,看 issues 字段里的字段路径。",
  NOT_FOUND: "目标资源不存在或已删除。",
  CONFLICT: "与现状冲突(slug 重复 / slot 占用 / 状态不允许等),看 errorMessage。",

  // API CRUD failures
  CREATE_FAILED: "创建失败,通常是 DB 约束冲突或 prisma 异常,看 server log。",
  UPDATE_FAILED: "更新失败,通常是 DB 约束冲突或 prisma 异常,看 server log。",
  DELETE_FAILED: "删除失败,可能有外键引用阻止,看 errorMessage。",
  SAVE_FAILED: "保存失败,看 errorMessage 里的具体原因。",
  DEPLOY_FAILED: "Deploy 失败,看 server log。",
  INVOKE_FAILED: "Invoke 调用入口失败,看 errorMessage。",
  IMPORT_FAILED: "Agent 导入失败,通常 envelope 校验或 skill 冲突未解,看 errorMessage。",
  RETRY_FAILED: "Retry 入口失败,可能 job 已 terminal 或不允许重试。",
  EQUIP_FAILED: "装备 skill 失败,看 errorMessage。",
  UNEQUIP_FAILED: "卸装 skill 失败,看 errorMessage。",
  WRITE_FAILED: "写盘失败,通常磁盘权限或路径不存在。",

  // API domain rules
  EQUIP_CAPACITY_EXCEEDED: "Agent 装备槽位已满(上限 6),先卸装一个再装。",
  SKILL_SLUG_CONFLICT: "Skill slug 已被占用,换一个 slug 或在导入时选 rename。",
  NO_FIELDS_TO_UPDATE: "请求体没有任何要更新的字段。",
  JOB_NOT_RETRYABLE: "AgentJob 状态不允许 retry(已 SUCCESS / 已用完 maxAttempts)。",
  JOB_IN_FLIGHT: "AgentJob 仍在 RUNNING,等它结束再 retry。",
  BINDING_AGENT_MISSING: "SceneBinding 引用的 agent 不存在,重新选 agent。",
  BINDING_AGENT_NOT_DEPLOYED: "Binding 目标 agent 还是草稿,先 deploy 再 sample-run。",

  // API validation
  INVALID_JSON: "请求体不是合法 JSON,检查 Content-Type 和 body 格式。",
  INVALID_FORM: "multipart form 解析失败,检查 Content-Type / boundary。",
  MISSING_FILE: "请求体缺 file 字段。",
  BASE64_INVALID: "base64 解码失败,检查传入字符串。",
  BUFFER_EMPTY: "解码后内容为空。",
  PATH_TRAVERSAL_BLOCKED: "路径里有 ../ 之类的越界片段,被 path-traversal 防护拒绝。",
};

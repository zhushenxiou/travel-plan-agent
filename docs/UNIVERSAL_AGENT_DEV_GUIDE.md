# 通用智能体架构 — 开发任务书

> **文档性质**：可直接落地的开发任务书，面向接手开发的 AI / 工程师
> **设计依据**：[`UNIVERSAL_AGENT_DESIGN.md`](./UNIVERSAL_AGENT_DESIGN.md)（已修订）
> **架构基线**：DDD 分层（`domain` / `infrastructure` / `application` / `api` / `frontend`）
> **重要原则**：本文档所有文件路径、类名、方法签名均经代码核查，与现状一致。改动前请先 `read_file` 确认当前内容。

---

## 〇、阅读须知

1. **先读设计文档**：`UNIVERSAL_AGENT_DESIGN.md` 是架构与决策依据，本文档是它的工程落地。两份文档冲突时，以本文档的"现状核查"为准（设计文档的部分代码示例为示意，真实路径以本文档为准）。
2. **关键修正（务必注意）**：
   - 设计文档 4.2 节提到"参考 `domain/travel/core.py` 的 `_run_loop`"——**实际不存在 `_run_loop` 方法**。真实的 ReAct 主循环在 [`domain/reasoning/engine.py`](../domain/reasoning/engine.py) 的 `ReasoningEngine.run()` / `run_stream()`（第 269 / 572 行）。DynamicAgent 重构应复用 `ReasoningEngine`，而非 domain/travel/core.py。
   - 设计文档 2.1 节（第 38 行）已修订：云合的 tool_calling **分阶段过渡**，初期保留 prompt 路由兜底，不一次性全量替换。Phase 3 按此执行。
   - 云合的 `system_prompt` / `description` **不得写死任何具体领域**（如"旅行规划""地图导航""航班查询"），可用智能体列表在运行时通过 `{agent_list}` 动态注入。新增智能体时云合配置零改动。
3. **每个任务都标注了依赖**，请按依赖顺序推进。同 Phase 内无依赖任务可并行。

---

## 一、现状速查表（已核查，改动前必读）

| 关注点 | 真实文件 | 现状（核查结论） |
|--------|----------|------------------|
| 智能体配置模型 | `domain/agent/schema.py` | `AgentConfig` 有 13 字段，**无 `mcp_servers`**；`SkillInfo` 有 7 字段，**无 `tools`、`category`** |
| 智能体基类 | `domain/agent/base.py` | `BaseAgent` 抽象 `chat()`→dict / `chat_stream()`→AsyncGenerator；返回值无 `status` 字段 |
| 自定义智能体 | `domain/agent/dynamic_agent.py` | **空壳**：仅 `llm.complete` + prompt 拼接，无工具执行、无会话记忆、无审计（第 20-28 行注释自述） |
| 工厂 | `domain/agent/factory.py` | `AgentFactory` 仅注入 `llm` + `skill_provider`，`create()` 对非内置走 `DynamicAgent` |
| 总调度 | `domain/agent/orchestrator.py` | `_route()` 用 prompt 让 LLM 返回 agent_id（单跳），无 function calling、无委派上下文 |
| 自定义智能体仓储 | `domain/agent/repository.py` | `custom_agents` 表无 `mcp_servers` 列；`_ALLOWED_FIELDS`（第 22-25 行）不含 `mcp_servers` |
| 推理引擎 | `domain/reasoning/engine.py` | `ReasoningEngine` 已有 `_build_tools_schema()`(167)、`run()`(269)、`run_stream()`(572)，用 `complete_with_tools`，`max_iterations` 来自 `settings` |
| 旅游 Agent 主循环 | `domain/travel/core.py` | `Agent` 类(49) 注入 session_store/tool_registry/tool_executor，内部委托 `ReasoningEngine` |
| 工具规格 | `infrastructure/tools/base.py` | `ToolSpec` 仅 `name/description/category/parameters`，**无渐进披露字段** |
| 工具策略 | `infrastructure/tools/policy.py` | `ToolPolicy.check(tool_name, arguments)` 仅硬编码 `run_shell`/`write_file` 规则，无 confirm_required 联动、无频率/权限 |
| Skill 提供者 | `infrastructure/skills/provider.py` | `FileSkillProvider._parse_skill()` 解析 SKILL.md frontmatter + openai.yaml `interface`，**不解析 `tools`/`category`** |
| MCP 目录 | `infrastructure/external/mcp/catalog.py` | `MCPCatalog` 有 `list_servers()`/`list_tool_refs()`/`select_tool_refs()`/`get_tool_ref()` |
| MCP 运行时 | `infrastructure/external/mcp/runtime.py` | `MCPProxyRuntime` 有 `adapter_available(proxy_name)`；仅 `web-search` 有 adapter（`build_default_adapters()`） |
| 会话管理 | `domain/user/session/manager.py` | `SessionManager` 有 `get/save/snapshot`；`sessions`/`session_turns` 表，**无委派上下文字段** |
| 依赖组装 | `app.py` | `build_orchestrator()`(112) 组装所有依赖；`AgentFactory` 未传 tool_executor/session_store/mcp_runtime |
| 内置智能体配置 | `application/builtin_agents/` | 仅 `travel.yaml`，**无 `yunhe.yaml`** |
| API 端点 | `api/server.py` | 有 `/api/skills`、`/api/agents`、`/api/agents/custom/*`；**无 `/api/mcp/servers`、无 `/api/skills/{name}`** |
| 前端 API | `frontend/src/utils/api.ts` | 有 `fetchSkills`/`fetchAgents`/`createCustomAgent` 等；**无 MCP 相关函数** |
| 前端页面 | `frontend/src/pages/` | 有 `AgentCenter.tsx`/`AgentEditor.tsx`；**无 `SkillCenter.tsx`/`MCPCenter.tsx`** |
| 前端路由 | `frontend/src/App.tsx` | 有 `/agents`、`/agents/create`、`/agents/edit/:agentId`；**无 `/skills`、`/mcps`** |
| 前端导航 | `frontend/src/components/NavSidebar.tsx` | 无 Skill/MCP 入口 |
| SSE 事件 | `api/server.py` `/api/chat/stream` | 事件类型：`status`/`chunk`/`done`/`error`/`tool_status`/`route`/`actions` |

---

## 二、全局约定

### 2.1 命名与目录

- **新建 Python 模块**：按 DDD 分层归位。领域逻辑进 `domain/`，技术实现进 `infrastructure/`，HTTP 进 `api/`。
- **新建前端页面**：放 `frontend/src/pages/`，组件放 `frontend/src/components/`。
- **MCP proxy 工具名**：沿用 `mcp__{server}__{tool}` 格式（见 `catalog.py` 的 `_proxy_name`）。
- **云合智能体 ID**：`yunhe`（全小写）。

### 2.2 数据库迁移

项目用 SQLite，无 Alembic。迁移方式：在 `infrastructure/persistence/database.py` 的 `init_db()` 中对新增列使用 `ALTER TABLE ... ADD COLUMN ...` 并 `try/except` 兼容已存在列（参考该文件现有迁移风格）。**所有新增列必须 `DEFAULT` 兜底**，读取时 `or []` / `or None` 防空。

### 2.3 向后兼容

- `AgentConfig` / `SkillInfo` / `ToolSpec` 新增字段必须有默认值，保证旧数据/YAML 不破坏。
- `BaseAgent.chat()` 返回值新增 `status` 字段时，**默认 `"final_answer"`**，保证现有 TravelAgent 等不破坏。
- `OrchestratorAgent` 改造保留 `__getattr__` 委托机制（第 59-69 行），避免破坏 `/api/sessions`、`/debug/*` 端点。

### 2.4 禁止事项

- ❌ 云合 `system_prompt` / `description` 出现具体领域名（旅行/地图/航班/机票等）。智能体列表必须 `{agent_list}` 动态注入。
- ❌ 在 `OrchestratorAgent` 中 import 任何具体 Agent 类（解耦原则，见 `orchestrator.py` 第 23 行注释）。
- ❌ 一次性删除 prompt 路由。Phase 3 必须保留 `_route()` 作为兜底。
- ❌ 引入未在 `requirements`/`pyproject.toml` 中的新依赖而不说明。

---

## 三、Phase 1 — DynamicAgent 核心能力 + 渐进式披露基础（P0）

> **目标**：自定义智能体能真正执行工具、多轮对话；建立 skill→tool 映射与渐进式披露字段基础。
> **验收**：创建一个勾选了 skill 的自定义智能体，多轮对话中能真实调用该 skill 绑定的工具并返回结果。

### 任务 1.1 — `AgentConfig` 增加 `mcp_servers` 字段

- **文件**：`domain/agent/schema.py`（修改）
- **现状**：第 5-24 行 `AgentConfig`，无 `mcp_servers`。
- **改动**：在 `skills` 字段后增加 `mcp_servers: list[str] = field(default_factory=list)`。
- **验收**：import 不报错；旧 YAML / DB 行加载时该字段为 `[]`。

### 任务 1.2 — `SkillInfo` 增加 `tools` / `category` 字段

- **文件**：`domain/agent/schema.py`（修改）
- **改动**：`SkillInfo` 增加 `tools: list[str] = field(default_factory=list)` 与 `category: str = "general"`。
- **验收**：`FileSkillProvider` 加载后能填充这两个字段（见 1.4）。

### 任务 1.3 — `custom_agents` 表增加 `mcp_servers` 列

- **文件**：`domain/agent/repository.py`（修改） + `infrastructure/persistence/database.py`（修改迁移）
- **现状**：`_ALLOWED_FIELDS`（第 22-25 行）不含 `mcp_servers`；`create()` INSERT（第 34-37 行）无该列；`_row_to_config()`（第 122-138 行）未读该列。
- **改动**：
  1. `database.py` 的 `init_db()` 中 `ALTER TABLE custom_agents ADD COLUMN mcp_servers TEXT DEFAULT '[]'`（try/except 兼容）。
  2. `_ALLOWED_FIELDS` 加入 `"mcp_servers"`。
  3. `create()` INSERT 增加 `mcp_servers` 列，值为 `json.dumps(fields.get("mcp_servers", []))`。
  4. `update()` 中若 `mcp_servers` 在 fields 内，`json.dumps` 序列化。
  5. `_row_to_config()` 增加 `mcp_servers=json.loads(row["mcp_servers"] or "[]")`。
- **验收**：创建/更新/读取自定义智能体时 `mcp_servers` 正确持久化与回填。

### 任务 1.4 — `FileSkillProvider` 解析 `tools` / `category`

- **文件**：`infrastructure/skills/provider.py`（修改）
- **现状**：`_parse_skill()`（第 51-100 行）从 `openai.yaml` 的 `interface` 读 `display_name`/`default_prompt`，未读 `tools`/`category`。
- **改动**：在解析 `interface` 处增加 `tools = interface.get("tools", [])` 与 `category = interface.get("category", "general")`，传入 `SkillInfo(...)`。
- **验收**：对 `infrastructure/skills/builtin/` 下任一 `openai.yaml` 增加测试性 `tools` 字段后，`list_skills()` 返回值含该字段。

### 任务 1.5 — `openai.yaml` 声明 `tools`（示例先行）

- **文件**：`infrastructure/skills/builtin/fliggy-travel/agents/openai.yaml`（修改，如存在）+ 至少 1 个 skill
- **改动**：在 `interface` 下增加 `tools: [...]` 与 `category: "travel"`，工具名需与 `ToolRegistry` 中注册名一致（查 `infrastructure/tools/adapters/fliggy.py` 的 `get_fliggy_specs()`）。
- **注意**：只填真实存在的工具名，否则 DynamicAgent 加载时会找不到工具。
- **验收**：`SkillInfo.tools` 非空且工具名能在 registry 命中。

### 任务 1.6 — `ToolSpec` 扩展渐进披露字段

- **文件**：`infrastructure/tools/base.py`（修改）
- **现状**：`ToolSpec`（第 8-13 行）仅 4 字段。
- **改动**：增加（均带默认值）：
  - `short_description: str = ""`
  - `disclosure_keywords: list[str] = field(default_factory=list)`
  - `confirm_required: bool = False`
  - `tier: str = "standard"`（`core`/`standard`/`advanced`）
  - `skill_binding: str = ""`
  - `mcp_source: str = ""`
  - 增加方法 `to_summary()` 与 `to_openai_schema()`（见设计文档 4.5.5）
- **注意**：`ToolSpec` 是 `@dataclass`，新增带默认值字段后，`MCPProxyRuntime.build_specs()`（runtime.py 第 310-320 行）等处构造 `ToolSpec(name=, description=, category=)` 仍可工作（默认值兜底）。
- **验收**：现有工具注册流程不报错；新字段可被读取。

### 任务 1.7 — `DynamicAgent` 重构为 ReAct Agent（核心）

- **文件**：`domain/agent/dynamic_agent.py`（重写）
- **依赖**：1.1、1.2、1.6
- **现状**：`DynamicAgent`（第 13-90 行）仅 `llm.complete` + `_build_prompt`。
- **改动**：
  1. 构造函数增加依赖：`tool_registry: ToolRegistry`、`tool_executor: ToolExecutor`、`session_store: SessionManager`、`mcp_runtime: MCPProxyRuntime`、`audit_logger: AuditLogger`。
  2. 新增 `_resolve_tools(config)`：遍历 `config.skills`→`skill_provider.get_skill(name).tools`；遍历 `config.mcp_servers`→`mcp_runtime.catalog.list_tool_refs()` 中 `server_identifier` 匹配项的 `proxy_name`。返回去重后的工具名列表。
  3. `chat()` / `chat_stream()`：**会话管理在 DynamicAgent 层做**（参考 `domain/travel/core.py:Agent`：调用 engine 前从 `session_store` 加载历史，调用后保存）。`ReasoningEngine` 构造签名为 `(llm, tool_registry, tool_executor, audit_logger)`——**不接收 session_store**，它只负责单轮推理 + 工具循环。`audit_logger` 记录由 engine 内部完成。
  4. **工具子集方案（关键）**：`ReasoningEngine._build_tools_schema()` 当前遍历 `tool_registry._tools` 全量构建（engine.py 第 167-172 行）。DynamicAgent 需要工具子集，有两种方案：
     - **方案 A（推荐，独立于 1.10）**：DynamicAgent 新建一个 `ToolRegistry` 实例，从全局 registry 中按 `_resolve_tools()` 结果只注册子集工具，传给 `ReasoningEngine`。
     - 方案 B：依赖任务 1.10 的 `disclosed_tools` 子集改造。
     建议采用方案 A，使 1.7 与 1.10 解耦可并行。
  5. **复用 `ReasoningEngine`，不要自己写 ReAct 循环**。
- **关键参考**：`domain/travel/core.py` 的 `Agent` 类如何组装 `ReasoningEngine` + `ToolExecutor` + `SessionManager`（第 50-110 行）——DynamicAgent 应复刻这套组装模式，区别只在工具来源（Agent 按意图筛选，DynamicAgent 按 config.skills/mcp_servers 筛选）。
- **验收**：
  - 创建勾选 fliggy skill 的自定义智能体，对话"查北京到上海机票"能真实调用 `fliggy_search_flights` 并返回结果。
  - 连续两轮对话保留上下文（第二轮"换个日期"能命中第一轮信息）。
  - `audit_logger` 有 LLM 调用与工具调用记录。

### 任务 1.8 — `AgentFactory` 注入新依赖

- **文件**：`domain/agent/factory.py`（修改）
- **依赖**：1.7
- **改动**：`__init__` 增加 `tool_registry`、`tool_executor`、`session_store`、`mcp_runtime`、`audit_logger` 参数；`create()` 中 `DynamicAgent(...)` 透传这些依赖。
- **验收**：工厂创建的 DynamicAgent 拥有完整依赖。

### 任务 1.9 — `app.py` 组装新依赖

- **文件**：`app.py`（修改）
- **依赖**：1.8
- **现状**：`build_orchestrator()`（第 112-163 行）构建了 `tool_registry`/`tool_executor`/`session_store`/`mcp_runtime` 等（在 `_build_travel_agent_core` 内），但 `AgentFactory` 只传了 `llm`/`skill_provider`。
- **改动**：在 `build_orchestrator()` 中显式构建 `tool_registry`/`tool_executor`/`session_store`/`mcp_runtime`/`audit_logger`（可与 `_build_travel_agent_core` 共享实例，避免重复初始化），传入 `AgentFactory`。
- **注意**：当前 `tool_registry` 等在 `_build_travel_agent_core` 局部创建。需把这些依赖上提到 `build_orchestrator` 作用域，再传给 `_build_travel_agent_core` 和 `AgentFactory`，保证全局单例。
- **验收**：启动后端，创建自定义智能体并对话能走通 ReAct 循环。

### 任务 1.10 — `ReasoningEngine` 支持按 `disclosed` 子集构建工具 schema

- **文件**：`domain/reasoning/engine.py`（修改）
- **现状**：`_build_tools_schema()`（第 167 行）全量构建。
- **改动**：`_build_tools_schema()` 增加可选参数 `disclosed_tools: set[str] | None = None`；当传入时只包含该子集工具。`run()`/`run_stream()` 读取 `session_state` 中的 `disclosed_tools`（默认 None=全量，保持向后兼容）。**注意现有缓存**：`_build_tools_schema` 第 168-169 行有 `if self._tools_schema is not None: return` 缓存，改造时需把缓存改为按 `disclosed_tools` 做 key，或当 disclosed 非空时绕过缓存，否则子集不生效。
- **验收**：传 `disclosed_tools={"fliggy_search_flights"}` 时 schema 仅含该工具；不传时行为不变。

---

## 四、Phase 2 — MCP/Skill 端点 + 前端中心 + 渐进式披露完善（P1）

> **目标**：用户能浏览 MCP/Skill，创建智能体时能选 MCP；渐进式披露机制完善。
> **验收**：前端有 Skill 中心、MCP 中心；AgentEditor 可多选 MCP；新建智能体绑定 MCP 后对话能调用 MCP 工具。

### 任务 2.1 — MCP API 端点

- **文件**：`api/server.py`（修改）
- **现状**：无 MCP 端点（已有 `/debug/mcp` 调试用，第 464 行）。
- **改动**：新增：
  - `GET /api/mcp/servers` — 返回所有 MCP server，含 `tools` 列表与 `adapter_available` 状态（用 `MCPProxyRuntime.adapter_available(proxy_name)`）。
  - `GET /api/mcp/servers/{server_id}` — 单个 server 详情。
  - `GET /api/mcp/servers/{server_id}/tools` — 该 server 的工具列表。
- **依赖来源**：`app.py` 的 `AppContainer` 需暴露 `mcp_runtime` / `mcp_catalog`（见 2.4）。
- **验收**：`curl /api/mcp/servers` 返回 JSON，`web-search` 的工具 `adapter_available=true`，`chrome-devtools` 为 `false`。

### 任务 2.2 — Skill 详情端点

- **文件**：`api/server.py`（修改）
- **现状**：`GET /api/skills`（第 269 行）返回列表，无单条详情。
- **改动**：新增 `GET /api/skills/{skill_name}`，返回含 `tools`/`category` 的 `SkillInfo`。
- **验收**：`curl /api/skills/fliggy-travel` 返回含 `tools` 字段。

### 任务 2.3 — `AppContainer` 暴露 MCP 依赖

- **文件**：`app.py`（修改）
- **改动**：`AppContainer` dataclass 增加 `mcp_runtime`、`mcp_catalog` 字段；`build_orchestrator()` 填充。
- **验收**：API 层能从容器拿到 MCP 依赖。

### 任务 2.4 — 前端 MCP/Skill API 函数

- **文件**：`frontend/src/utils/api.ts`（修改）
- **改动**：新增 `fetchMCPServers()`、`fetchMCPServer(id)`、`fetchSkillDetail(name)`；新增 `MCPServerInfo`/`MCPToolInfo` 类型。`AgentInfo` 类型增加 `mcp_servers?: string[]`。
- **验收**：类型与后端字段对齐。

### 任务 2.5 — Skill Center 页面

- **文件**：`frontend/src/pages/SkillCenter.tsx`（新建）
- **改动**：分类筛选 + Skill 卡片（名称/描述/环境变量配置状态/绑定工具/图标）。参考设计文档 4.9.1。
- **验收**：页面渲染 skill 列表，未配置环境变量的 skill 有明显标识。

### 任务 2.6 — MCP Center 页面

- **文件**：`frontend/src/pages/MCPCenter.tsx`（新建）
- **改动**：MCP server 卡片（名称/描述/工具列表/`adapter_available` 状态）。参考设计文档 4.9.2。
- **验收**：`web-search` 显示"可用"，`chrome-devtools` 显示"未安装 adapter"。

### 任务 2.7 — AgentEditor 增加 MCP 多选器

- **文件**：`frontend/src/pages/AgentEditor.tsx`（修改）
- **改动**：表单增加 MCP 多选区（仅展示 `adapter_available=true` 的可选，或对不可用的置灰提示）；提交时带 `mcp_servers` 字段。
- **验收**：创建智能体时能勾选 `web-search`，保存后 DB `mcp_servers` 列非空。

### 任务 2.8 — NavSidebar 增加入口 + App.tsx 路由

- **文件**：`frontend/src/components/NavSidebar.tsx`（修改）、`frontend/src/App.tsx`（修改）
- **改动**：NavSidebar 增加"Skill 中心""MCP 中心"入口；App.tsx 增加 `/skills`、`/mcps` 路由（套 `PrivateRoute`）。
- **验收**：点击导航能进入对应页面。

### 任务 2.9 — 渐进式披露 function calls

- **文件**：`domain/reasoning/engine.py`（修改）
- **依赖**：1.10
- **改动**：在工具 schema 中始终包含 `load_skill_detail`/`load_mcp_info`/`load_tool_detail` 三个 meta function（定义见设计文档 4.5.3）；在 `run`/`run_stream` 的 tool_call 处理分支中，识别这三个调用，分别返回详情并将工具名加入 `disclosed_tools`，下一轮迭代该工具进入 native tools。
- **验收**：LLM 调 `load_tool_detail("fliggy_search_flights")` 后，下一轮能直接调用该工具。

### 任务 2.10 — `ToolSelector` 自动推荐

- **文件**：`domain/reasoning/tool_selector.py`（新建）
- **改动**：实现设计文档 4.5.6 的 `ToolSelector`，基于 `disclosure_keywords`/`category`/工具名打分。在 `ReasoningEngine` 每轮开始前调用，将 top-N 加入 `disclosed_tools`。
- **验收**：用户消息"查航班"时 `fliggy_search_flights` 被自动推荐披露。

### 任务 2.11 — Session 持久化 `disclosed_tools`

- **文件**：`domain/user/session/manager.py`（修改） + `infrastructure/persistence/database.py`（修改）
- **改动**：`sessions` 表增加 `disclosed_tools TEXT DEFAULT '[]'`；`SessionManager` 增加读写方法。
- **验收**：会话刷新后已披露工具集不丢失。

---

## 五、Phase 3 — 云合智能体 + 委派上下文（P2）

> **目标**：默认智能体"云合"具备通用对话 + 智能委派能力，支持多智能体协作与子智能体追问。
> **策略（重要）**：按设计文档修订，**分阶段过渡**。先试点 tool_calling 委派，保留 `_route()` prompt 路由作为兜底；待可靠性达标后再逐步切换为默认路径。不要一次性删除 prompt 路由。

### 任务 3.1 — 云合 YAML 配置

- **文件**：`application/builtin_agents/yunhe.yaml`（新建）
- **改动**：参考设计文档 4.4.4，但**严格遵守禁止事项**——`description` 与 `system_prompt` 不得出现任何具体领域名。`system_prompt` 中"可用智能体"用 `{agent_list}` 占位，运行时注入。`skills: []`、`mcp_servers: []`、`temperature: 0.7`。
- **自检**：grep 该文件，确保无"旅行""地图""航班""机票"等词。
- **验收**：`BuiltinAgentLoader.load_all()` 能加载 yunhe 配置。

### 任务 3.2 — `OrchestratorAgent` 改造（tool_calling 委派 + prompt 兜底）

- **文件**：`domain/agent/orchestrator.py`（修改）
- **依赖**：3.1
- **现状**：`_route()`（第 92-119 行）prompt 路由；`chat()`/`chat_stream()`（第 158-182 行）单跳委派。
- **改动**（分阶段）：
  1. 新增 meta-tools 常量 `YUNHE_META_TOOLS`（`delegate_to`、`list_available_agents`、`recall_delegation`），定义见设计文档 4.4.5。
  2. 新增 `_build_yunhe_prompt(user_id)`：用 `_get_all_descriptions(user_id)`（已有，第 71-90 行）的输出替换 `{agent_list}`。
  3. 新增 `_direct_reply()`（不注入 tools 的直答路径）与 `_is_fast_chat()`（Tier 0 规则快路径）。
  4. 新增 tool_calling 委派主循环（参考设计文档 4.4.6），但**保留 `_route()` 作为兜底**：当 tool_calling 委派失败/异常/未配置时，fallback 到 `_route()` + 单跳委派，保证可用性。
  5. `_MAX_DELEGATIONS = 3` 防死循环。
- **注意**：`OrchestratorAgent` 现有 `__getattr__` 委托到默认 agent（第 59-69 行），改造时保留，避免破坏 `/api/sessions` 等端点。
- **验收**：
  - "你好"走快路径直答（无 tool_calling 开销）。
  - "帮我规划云南5日游"走 tool_calling 委派给 travel（或兜底 `_route`）。
  - 委派 ≤3 次；异常时 fallback 到 prompt 路由不崩溃。

### 任务 3.3 — `BaseAgent` 交接协议（`status` 字段）

- **文件**：`domain/agent/base.py`（修改）
- **改动**：`chat()` 返回 dict 约定增加 `status: "final_answer" | "need_input" | "cannot_handle"`（默认 `final_answer`，保证向后兼容）；`need_input` 时带 `missing_info: list[str]`。
- **注意**：现有 `TravelAgent.chat()` 返回 `{"status": "completed", ...}`（见 domain/travel/core.py 第 115/185/227 行）。需在 TravelAgent 适配层把 `"completed"` 映射为 `"final_answer"`，或让云合兼容 `"completed"`。
- **验收**：云合能根据子智能体 `status` 决定保持/释放委派。

### 任务 3.4 — 委派上下文状态机

- **文件**：`domain/agent/orchestrator.py`（修改）
- **依赖**：3.2、3.3
- **改动**：实现设计文档 4.4.9 的 `DelegationContext` + 状态机（IDLE / DELEGATED）。`chat_stream` 入口先检查活跃委派，有则直接转发给当前智能体（跳过 Tier 0/1）。超时 1800s 自动释放。
- **验收**：子智能体 `need_input` 时，用户下一轮消息直接转发给它，不被云合重新路由。

### 任务 3.5 — 委派上下文持久化

- **文件**：`domain/user/session/manager.py`（修改） + `infrastructure/persistence/database.py`（修改）
- **改动**：`sessions` 表增加 `delegation_agent_id`/`delegation_started_at`/`delegation_last_interaction`；`SessionManager` 增加 `get_delegation`/`set_delegation`/`clear_delegation`。
- **验收**：服务重启后会话委派状态可恢复。

### 任务 3.6 — 共享 function calls

- **文件**：`domain/reasoning/engine.py`（修改）
- **改动**：实现 `recall_memory`/`get_current_time`/`request_confirmation`/`http_request`（设计文档 4.5.4）。`http_request` 已有（`infrastructure/tools/adapters/http.py`），复用即可。
- **验收**：子智能体能调用 `get_current_time` 获取当前时间。

### 任务 3.7 — 云合作为默认智能体接入

- **文件**：`app.py`（修改） + `domain/agent/orchestrator.py`（修改）
- **依赖**：3.2
- **改动**：`build_orchestrator()` 中 `default_agent` 由 `"travel"` 改为 `"yunhe"`。
- **关键设计（避免循环依赖）**：**云合即 `OrchestratorAgent` 自身，不通过 `AgentFactory` 创建**。orchestrator 持有 factory，若 factory 再创建云合会循环。`default_agent="yunhe"` 的含义是：`orchestrator.chat()` 在未指定 `agent_id` 时，**直接执行自身的云合决策逻辑**（Tier 0/1/2，任务 3.2 已实现），而非调用 `_route()` 路由到别的智能体。只有当云合决定委派时，才通过 `factory.create(agent_id)` 创建**子**智能体（如 travel）。
- **注意**：改默认会影响所有未指定 agent_id 的对话。需确保云合能正确委派给 travel。如有风险，可加配置开关 `default_agent` 在 `config/settings` 中切换，灰度验证后再固定为 `yunhe`。
- **验收**：首页对话默认走云合，专业任务被委派给 travel；云合自身不经过 factory 创建。

---

## 六、Phase 4 — 功能完善与体验优化（P2）

> 社区产品要的是功能丰富、体验好，不需要商用 SaaS 那套（计费/多租户/RBAC/GDPR）。以下只保留对社区分享有价值的内容。

### 6.1 成本与安全（社区产品也需要）

- **CostGuard**：`domain/reasoning/engine.py` 加 token 预算 + 工具调用上限检查。自用/社区分享都有 API 费用，需要有上限防止刷爆。
- **ToolPolicy 安全策略**：`infrastructure/tools/policy.py` 联动 `ToolSpec.confirm_required`，对高风险工具（写文件、HTTP 请求等）弹确认框，防止用户被恶意智能体调用意外工具。限频只做简单版（每分钟 N 次即可，不需要按角色分级）。
- **内容安全基座**：新建 `domain/safety/prompt_guard.py`（Prompt 注入防御，聊胜于无的基础规则）；输入输出 moderation 可选接入，不强求。
- **LLM 降级链**：新建 `infrastructure/llm/fallback.py`，多 provider fallback。社区用户可能在各种网络环境下用，API 偶尔不可用，降级能提升可用性。

### 6.2 稳定性与体验

- **错误处理标准化**：`ReasoningEngine` 加 `_execute_tool_safely`，工具超时/连接失败/参数错误有统一兜底，LLM 能感知错误并重试或引导用户，不会让用户看到原始的 Python traceback。
- **前端事件协议**：`ChatWindow.tsx` 处理以下 SSE 事件类型，让对话过程有流畅的状态反馈：
  - `route` — "正在为您转接 XX 智能体..."
  - `tool_start` — "正在搜索航班..." + 加载动画
  - `need_confirmation` — 高风险操作确认弹窗
  - `need_input` — 智能体追问（如"请问从哪出发？"）
  - `error` — 友好错误提示而非白屏
- **智能体草稿/发布状态**：`custom_agents` 表增加 `status` 字段（`draft` / `published`），AgentCenter 只展示 `published` 的智能体。简单实用，不需要复杂的版本管理。

### 6.3 反馈闭环

- **对话质量反馈**：每个回复后 👍/👎 按钮 + 可选文字反馈，新建 `domain/feedback/` 模块 + `quality_issues` 表。社区用户反馈是产品迭代的重要来源。

### 6.4 明确不做（留给商用版）

以下是有价值但超出社区产品范围的功能，若以后要商用再加：
- ❌ 多租户组织隔离
- ❌ 计费配额体系
- ❌ RBAC 多角色权限矩阵
- ❌ GDPR/PIPL 合规（数据导出/被遗忘权）
- ❌ 独立 Metrics 系统（日志够用）
- ❌ DB 迁移 PostgreSQL

---

## 七、Phase 5 — 生态扩展（P3，可选）

> 让产品功能更丰富、覆盖更多场景。社区用户最关心的"能不能做更多事"。

- **MCP adapter 扩展**：为已有 server metadata 的 MCP 实现 runtime adapter，按优先级：`web-search`（✅已有）→ `chrome-devtools`（浏览器自动化）→ `tencent-docs`（腾讯文档读写）→ `wecom-doc`（企业微信文档）。这是社区产品功能丰富度的核心体现。
- **智能体市场（社区版）**：用户在 AgentCenter 可将私有智能体发布到公共市场，其他用户可"克隆"到自己的工作区。无需审核流程（社区信任），简单发布/克隆即可。
- **前后端 i18n**：如果面向全球社区，前端接入 i18next，后端错误信息按 `Accept-Language` 返回。中文社区可跳过。
- **全局限流（轻量版）**：按 user_id + IP 简单限流，防止恶意请求（SQLite 计数器即可，不需要 Redis）。

---

## 八、联调与验收清单

### Phase 1 验收
- [ ] 创建自定义智能体（勾选 fliggy skill），对话能真实调用 `fliggy_search_flights`
- [ ] 自定义智能体支持多轮对话（上下文保留）
- [ ] `custom_agents` 表 `mcp_servers` 列正确读写
- [ ] `SkillInfo.tools` / `ToolSpec` 新字段不破坏现有流程
- [ ] `audit_logger` 记录 LLM 与工具调用

### Phase 2 验收
- [ ] `/api/mcp/servers` 返回含 `adapter_available` 的列表
- [ ] `/api/skills/{name}` 返回含 `tools` 的详情
- [ ] 前端 Skill Center / MCP Center 可访问
- [ ] AgentEditor 可多选 MCP 并保存
- [ ] NavSidebar 有 Skill/MCP 入口，路由可达
- [ ] 渐进式披露：`load_tool_detail` 后工具可被调用
- [ ] `ToolSelector` 自动推荐相关工具

### Phase 3 验收
- [ ] 云合 YAML 无任何具体领域名（grep 自检）
- [ ] "你好"走快路径直答
- [ ] 专业任务被委派给 travel
- [ ] 多智能体协作（委派 ≤3 次）
- [ ] 子智能体追问时，用户回复直接转发（不重路由）
- [ ] 委派异常时 fallback 到 prompt 路由不崩溃
- [ ] 服务重启后委派上下文可恢复
- [ ] `/api/sessions`、`/debug/*` 端点未被破坏

---

## 九、常见坑与注意事项

1. **`OpenAILLM` 方法名**：是 `complete` / `stream_complete` / `complete_with_tools` / `complete_json`，没有 `chat` 方法（见 `dynamic_agent.py` 第 52 行注释）。
2. **`get_connection()` 不是上下文管理器**：需手动 `commit()` + `close()`（见 `repository.py` 第 18-19 行注释）。
3. **`OrchestratorAgent.__getattr__`**：委托未定义方法到默认 agent，改造时勿破坏（影响 `/api/sessions` 等）。
4. **工具名一致性**：`openai.yaml` 的 `tools` 必须与 `ToolRegistry` 注册名完全一致，否则 DynamicAgent 加载不到工具。
5. **`MCPProxyRuntime.build_specs()`**：构造 `ToolSpec` 时只传 name/description/category，`ToolSpec` 新增字段必须有默认值，否则此处报错。
6. **`complete_with_tools` 已有 fallback**：`openai.py` 第 119-135 行，tool_calling 失败时自动降级为文本模式。云合委派失败时再叠加 `_route()` 兜底，形成双层兜底。
7. **云合提示词**：任何修改后都 grep 一遍 `application/builtin_agents/yunhe.yaml`，确保无具体领域词——这是设计文档明确要求的可扩展性原则。
8. **DB 迁移幂等**：`ALTER TABLE ADD COLUMN` 重复执行会报错，必须 `try/except`。
9. **`default_agent` 切换影响面大**：Phase 3 任务 3.7 把默认从 travel 改为 yunhe，会影响所有未指定 agent_id 的对话。建议先用配置开关灰度。
10. **`TravelAgent` 返回 `status: "completed"`**：与交接协议的 `"final_answer"` 不一致，云合需兼容或适配层映射。

---

## 十、开发顺序建议

```
Phase 1（串行为主，1.1-1.6 可并行，1.7 依赖 1.1/1.2/1.6，1.8 依赖 1.7，1.9 依赖 1.8）
  1.1 ─┐
  1.2 ─┼─→ 1.7 → 1.8 → 1.9
  1.6 ─┘              1.10（可与 1.7-1.9 并行）
  1.3、1.4、1.5（独立，可并行）

Phase 2（2.1-2.3 后端先行，2.4-2.8 前端，2.9-2.11 披露机制）
  2.3 → 2.1 → 2.2（后端）
  2.4（前端 API）→ 2.5/2.6/2.7/2.8（前端页面）
  1.10 → 2.9 → 2.10/2.11（披露）

Phase 3（3.1 独立，3.2 依赖 3.1，3.4 依赖 3.2/3.3，3.5 依赖 3.4，3.7 最后）
  3.1 → 3.2 → 3.4 → 3.5
       3.3（与 3.2 并行）
       3.6（独立）
       3.7（最后，灰度切换）
```

**每个 Phase 完成后，对照第八节验收清单逐项检查，全部通过再进入下一 Phase。**

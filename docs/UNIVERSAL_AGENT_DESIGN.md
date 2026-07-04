# 通用智能体架构设计文档

> **文档状态**：设计提案
> **日期**：2026-07-01
> **作者**：基于用户需求整理

---

## 一、用户愿景回顾

用户的核心诉求是构建一个**通用智能体平台**，具体包含：

1. **默认智能体"云合"**：通用调度者，具备委派、查看子智能体等 function call 能力，但自身不绑定 skill/MCP，职责是"把专业的事交给专业的人"
2. **Agent 中心**：用户可浏览内置智能体、创建自定义智能体（勾选 skill 和 MCP）
3. **Skill 中心**：前端展示所有可用技能，供用户浏览和在自定义智能体中选用
4. **MCP 中心**：前端展示所有可用 MCP 服务端及其工具，供用户浏览和选用
5. **专业智能体**：每个智能体有独有的 skill 和 MCP 组合

---

## 二、设计点评与补充

### 2.1 "云合"作为纯调度者 — 点评

**优点**：
- 职责单一，符合 Unix 哲学"做一件事并做好"
- 避免了默认智能体功能膨胀，维护成本低
- 用户心智模型清晰：跟云合聊天 = 让他帮我找对的人

**需要补充的细节**：
- 云合的"委派"不应只是当前的**单跳 LLM 路由**（选一个智能体就完事），而应支持**多轮委派**：用户说"帮我规划云南行程然后发一条朋友圈"，云合应该能先委派旅行智能体，拿到结果后再委派社交智能体
- 云合需要具备以下 **meta-function-call**（对用户不可见的系统能力）：
  - `list_agents()` — 列出所有可用智能体及能力描述
  - `delegate_to(agent_id, message)` — 将消息委派给指定智能体
  - `summarize_agent_result(agent_id, result)` — 将子智能体的结果摘要返回给用户
  - `check_agent_status(agent_id)` — 检查某智能体是否可用（skill 环境变量是否配置等）

**建议**：云合的 function call 可朝 LLM 原生 tool_calling 方向演进（底层 `OpenAILLM.complete_with_tools` 已具备该能力），让 LLM 自主决定何时委派、委派给谁，而非靠关键词匹配。但完全替代现有 prompt 路由在现阶段改造范围大、调度可靠性需验证，建议**分阶段过渡**：初期保留 prompt 路由作为基线与兜底，先在小范围场景试点 tool_calling 委派，待可靠性达标后再逐步切换，避免一次性大重构带来的风险。

### 2.2 Agent 中心 + 自定义智能体 — 点评

**优点**：
- 已有 CRUD 基础（DB 持久化、API、前端表单）
- 支持"我的智能体"和"社区智能体"分层

**关键缺失（必须补齐）**：
- 当前 `DynamicAgent` **无工具执行能力**、**无会话记忆** — 这是最大瓶颈
  - 代码注释（`domain/agent/dynamic_agent.py` 第 20-28 行）明确承认：MVP 阶段只做 prompt 注入，不调用工具
  - 这意味着用户创建的自定义智能体实际上只是"带 system_prompt 的 ChatGPT"，无法执行任何 skill 或 MCP
- `AgentConfig` **没有 `mcp_servers` 字段** — 自定义智能体无法绑定 MCP
- Skill 与工具之间**没有映射关系** — 勾选了 skill 也不会加载对应工具

**建议**：
- `DynamicAgent` 需要重构为完整的 ReAct Agent（推理→行动→观察循环），注入 `ToolExecutor`、`SessionManager`
- Skill 需要声明其绑定的工具名（在 `SKILL.md` 或 `openai.yaml` 中增加 `tools: [tool_name1, tool_name2]` 字段）
- AgentConfig 增加 `mcp_servers: list[str]` 字段

### 2.3 Skill 中心 — 点评

**优点**：
- `SkillProvider` 抽象设计好，支持未来 DB/Remote 实现
- 已有 `GET /api/skills` API

**需要补充**：
- 前端需要独立的 Skill Center 页面（当前 skill 只在 AgentEditor 中以勾选项出现）
- Skill 详情应展示：名称、描述、所需环境变量及配置状态、绑定的工具列表、使用示例
- Skill 可按类别分组（旅行、办公、搜索、开发等）
- 需要 `GET /api/skills/{name}` 端点返回单个 skill 详情

### 2.4 MCP 中心 — 点评

**优点**：
- `MCPCatalog` 已有扫描和检索能力
- `MCPProxyRuntime` 有 adapter 机制

**关键缺失**：
- **无 MCP API 端点** — 前端完全无法获取 MCP 列表
- **AgentEditor 无 MCP 选择 UI**
- **AgentConfig 无 MCP 字段**
- **DynamicAgent 不接入 MCP**
- 当前只有 `web-search` 一个真实可用的 MCP server（`chrome-devtools`、`tencent-docs` 等只有关键词 hints，无实际 server 文件）
- `MCPProxyRuntime` 只有 2 个 adapter 实现，未注册 adapter 的工具调用会报错

**建议**：
- 新增 `GET /api/mcp/servers` 和 `GET /api/mcp/servers/{id}` API
- 前端新增 MCP Center 页面
- AgentEditor 增加 MCP 多选器
- MCP server 需要标注 `adapter_available` 状态（是否有 runtime 实现）

### 2.5 当前架构的 LLM 路由问题

当前 `OrchestratorAgent._route()` 的实现是：把所有智能体描述拼成 prompt，让 LLM 返回一个 agent_id。这种方式的问题：

1. **单跳路由**：只能选一个智能体，无法处理需要多智能体协作的复杂请求
2. **路由失败无优雅降级**：LLM 返回不存在的 ID 时直接 fallback 到默认智能体
3. **无意图澄清**：用户说"帮我查一下"，云合无法追问"查什么？机票还是酒店？"

**建议**：用 function calling 替代 prompt 路由。云合的 LLM 通过 `delegate_to(agent_id, message)` 这个 tool call 来委派，可以在一次对话中多次委派不同智能体。

---

## 三、当前架构能力评估

### 3.1 已有基础（可直接复用）

| 能力 | 实现位置 | 评估 |
|------|----------|------|
| DDD 分层架构 | domain/infrastructure/api/application/config | ✅ 基础扎实 |
| Agent 抽象接口 | `domain/agent/base.py` BaseAgent | ✅ 可直接复用 |
| 工厂模式 | `domain/agent/factory.py` AgentFactory | ✅ 可直接复用 |
| 内置智能体 YAML 配置 | `application/builtin_agents/` | ✅ 可直接复用 |
| 自定义智能体 CRUD | `domain/agent/repository.py` | ⚠️ 需加 mcp_servers 字段 |
| LLM 路由 | `domain/agent/orchestrator.py` | ⚠️ 需升级为 function calling |
| Skill 文件加载 | `infrastructure/skills/provider.py` | ✅ 可直接复用 |
| MCP 目录扫描 | `infrastructure/external/mcp/catalog.py` | ✅ 可直接复用 |
| MCP 运行时 | `infrastructure/external/mcp/runtime.py` | ⚠️ 需扩展 adapter |
| Tool 注册/执行 | `infrastructure/tools/registry.py` + `executor.py` | ✅ 可直接复用 |
| ToolPolicy 策略 | `infrastructure/tools/policy.py` | ✅ 可直接复用 |
| 审计日志 | `domain/shared/audit/logger.py` | ✅ 可直接复用 |
| SSE 流式输出 | `api/server.py` chat_stream | ✅ 可直接复用 |
| 前端 Agent 中心 | `frontend/src/pages/AgentCenter.tsx` | ✅ 可扩展 |
| 前端 Agent 编辑器 | `frontend/src/pages/AgentEditor.tsx` | ⚠️ 需加 MCP 选择器 |

### 3.2 核心缺口（必须新建）

| 缺口 | 影响范围 | 优先级 |
|------|----------|--------|
| **DynamicAgent 无工具执行** | 自定义智能体无法使用 skill/MCP | P0 |
| **DynamicAgent 无会话记忆** | 自定义智能体无法多轮对话 | P0 |
| **AgentConfig 无 mcp_servers 字段** | 无法绑定 MCP | P0 |
| **Skill → Tool 映射缺失** | 勾选 skill 不触发工具加载 | P0 |
| **MCP API 端点缺失** | 前端无法展示 MCP | P1 |
| **MCP Center 前端页面** | 用户无法浏览 MCP | P1 |
| **Skill Center 前端页面** | 用户无法浏览 Skill | P1 |
| **AgentEditor 无 MCP 选择器** | 创建智能体时无法选 MCP | P1 |
| **云合 function call 委派** | 无法多智能体协作 | P2 |
| **MCP adapter 覆盖不足** | 大部分 MCP 工具不可执行 | P2 |

---

## 四、详细架构设计

### 4.1 数据模型变更

#### 4.1.1 AgentConfig 扩展

```python
# domain/agent/schema.py

@dataclass
class AgentConfig:
    id: str
    name: str
    description: str
    icon: str = "🤖"
    system_prompt: str = ""
    skills: list[str] = field(default_factory=list)
    mcp_servers: list[str] = field(default_factory=list)   # 新增：绑定的 MCP server ID
    welcome_message: str = ""
    temperature: float = 0.7
    source: str = "builtin"
    is_public: bool = False
    user_id: str | None = None
    created_at: str = ""
    updated_at: str = ""
```

#### 4.1.2 SkillInfo 扩展

```python
@dataclass
class SkillInfo:
    name: str
    display_name: str
    description: str
    default_prompt: str
    requires_env: list[str]
    env_configured: bool
    icon: str = "🔧"
    tools: list[str] = field(default_factory=list)   # 新增：该 skill 绑定的工具名
    category: str = "general"                        # 新增：分类
```

#### 4.1.3 数据库 schema 变更

```sql
-- custom_agents 表新增 mcp_servers 字段（JSON 存储）
ALTER TABLE custom_agents ADD COLUMN mcp_servers TEXT DEFAULT '[]';
```

#### 4.1.4 SKILL.md / openai.yaml 扩展

```yaml
# infrastructure/skills/builtin/fliggy-travel/agents/openai.yaml
interface:
  display_name: "航班查询"
  default_prompt: "帮我查航班"
  tools:                          # 新增：声明该 skill 需要的工具
    - fliggy_search_flights
    - fliggy_search_hotels
  category: "travel"              # 新增：分类
i18n:
  zh:
    name: "航班查询"
    description: "查询机票价格和航班信息"
```

### 4.2 DynamicAgent 重构 — 核心改造

当前 `DynamicAgent` 是"空壳"（只做 prompt 注入），需要重构为完整的 ReAct Agent。

```
用户消息 → DynamicAgent.chat()
               ↓
         构建 system_prompt（config.system_prompt + skill 描述 + 工具描述）
               ↓
         LLM 推理（带 tool_calling）
               ↓
         ┌─ 有 tool_call → ToolExecutor 执行 → 结果回传 LLM → 继续推理 ─┐
         └─ 无 tool_call → 返回最终回复                                  │
               ↑─────────────────────────────────────────────────────────┘
               ↓
         SessionManager 保存对话历史
               ↓
         返回回复
```

**关键改造点**：

1. **注入依赖**：DynamicAgent 需要接收 `ToolExecutor`、`SessionManager`、`AuditLogger`
2. **工具加载**：根据 `config.skills` 查找对应的 tool names，从全局 ToolRegistry 中筛选注册
3. **MCP 加载**：根据 `config.mcp_servers` 从 MCPProxyRuntime 中加载对应 server 的工具
4. **会话记忆**：使用 SessionManager 管理多轮对话上下文
5. **ReAct 循环**：参考 `domain/travel/core.py` 中旅游 Agent 的主循环实现

```python
# domain/agent/dynamic_agent.py（重构后）

class DynamicAgent(BaseAgent):
    def __init__(
        self,
        *,
        config: AgentConfig,
        llm: OpenAILLM,
        skill_provider: SkillProvider,
        tool_registry: ToolRegistry,       # 新增
        tool_executor: ToolExecutor,       # 新增
        session_store: SessionManager,     # 新增
        mcp_runtime: MCPProxyRuntime,      # 新增
        audit_logger: AuditLogger,         # 新增
    ):
        self._config = config
        self._llm = llm
        self._tool_executor = tool_executor
        self._session_store = session_store
        self._audit_logger = audit_logger

        # 根据 config 加载工具
        self._tool_names = self._resolve_tools(config, skill_provider, mcp_runtime)

    def _resolve_tools(self, config, skill_provider, mcp_runtime) -> list[str]:
        """根据 config.skills 和 config.mcp_servers 解析需要的工具名。"""
        tool_names = []
        # 1. 从 skill 中提取绑定的工具
        for skill_name in config.skills:
            skill = skill_provider.get_skill(skill_name)
            if skill:
                tool_names.extend(skill.tools)
        # 2. 从 MCP server 中提取工具
        for server_id in config.mcp_servers:
            for ref in mcp_runtime.catalog.list_tool_refs():
                if ref.server_identifier == server_id:
                    tool_names.append(ref.proxy_name)
        return list(set(tool_names))

    async def chat(self, *, session_id, message, user_id=None, **kwargs):
        # ReAct 循环：参考 domain/travel/core.py 的 Agent._run_loop
        ...
```

### 4.3 AgentFactory 改造

工厂需要为 DynamicAgent 注入新的依赖：

```python
# domain/agent/factory.py

class AgentFactory:
    def __init__(
        self,
        *,
        llm: OpenAILLM,
        skill_provider: SkillProvider,
        tool_registry: ToolRegistry,       # 新增
        tool_executor: ToolExecutor,       # 新增
        session_store: SessionManager,     # 新增
        mcp_runtime: MCPProxyRuntime,      # 新增
        audit_logger: AuditLogger,         # 新增
        builtin_builders: dict[str, Callable[[AgentConfig], BaseAgent]] | None = None,
    ):
        ...

    def create(self, config: AgentConfig) -> BaseAgent:
        if config.source == "builtin" and config.id in self._builtin_builders:
            return self._builtin_builders[config.id](config)

        return DynamicAgent(
            config=config,
            llm=self._llm,
            skill_provider=self._skill_provider,
            tool_registry=self._tool_registry,
            tool_executor=self._tool_executor,
            session_store=self._session_store,
            mcp_runtime=self._mcp_runtime,
            audit_logger=self._audit_logger,
        )
```

### 4.4 云合智能体（默认调度者）设计

#### 4.4.1 核心定位

云合**不是纯路由器**，而是一个**具备通用对话能力的调度者**：

- ✅ **能做**：简单问答（闲聊、知识问答、写作、翻译、数学等通用 LLM 能力）
- ✅ **能做**：识别任务是否需要专业能力，需要时委派给专业智能体
- ❌ **不能做**：调用 skill/MCP 工具（任何依赖特定技能或 MCP 服务的专业工具）
- ❌ **不能做**：处理需要外部工具的专业任务

这与当前 `OrchestratorAgent` 的区别：

| 维度 | 当前 OrchestratorAgent | 云合（目标） |
|------|------------------------|-------------|
| 简单问题"你好" | 路由给 travel agent 处理（浪费） | 直接回复（高效） |
| 专业问题"规划云南行程" | prompt 路由选一个 agent | function calling 委派 |
| 多智能体协作 | ❌ 只能选一个 | ✅ 可多次 delegate_to |
| 通用知识问答 | ❌ 总是委派 | ✅ 直接回答 |
| 意图澄清 | ❌ 无 | ✅ 可追问 |

#### 4.4.2 三层决策架构

参考现有 `TravelIntentClassifier` 的三层分类模式（规则快路径 → 关键词匹配 → LLM 分类），云合采用类似的**三层决策架构**：

```
用户消息 → 云合
  ↓
  ┌─────────────────────────────────────────────────────┐
  │  Tier 0：规则快路径（零 LLM 调用，毫秒级）            │
  │  · 极短消息（"你好"、"谢谢"、"嗯"）→ 直接 LLM 回复    │
  │  · 明确闲聊关键词（"你是谁"、"讲个笑话"）→ 直接回复    │
  │  · 命中 → 走"直接回复"路径（不注入 delegate_to 工具） │
  │  · 未命中 → 进入 Tier 1                              │
  └──────────────────────────┬──────────────────────────┘
                             ↓
  ┌─────────────────────────────────────────────────────┐
  │  Tier 1：LLM function calling（主路径）               │
  │  · 构建 system_prompt（含可用智能体描述）              │
  │  · 注入 meta-tools: delegate_to, list_agents         │
  │  · LLM 自然决策：                                     │
  │    ├─ 不调 tool → 直接回复（通用问答）                 │
  │    ├─ 调 delegate_to → 委派给专业智能体                │
  │    └─ 意图不明 → 追问澄清                             │
  └──────────────────────────┬──────────────────────────┘
                             ↓
  ┌─────────────────────────────────────────────────────┐
  │  Tier 2：委派执行（仅当 Tier 1 触发 delegate_to）      │
  │  · 获取目标智能体实例                                  │
  │  · 执行 agent.chat() / chat_stream()                  │
  │  · 将结果回传给云合的 LLM                              │
  │  · LLM 决定：直接转述结果 / 再次委派 / 补充说明         │
  │  · 循环直到 LLM 不再调用 delegate_to（上限 3 次）      │
  └─────────────────────────────────────────────────────┘
```

**为什么用三层而非纯 function calling？**

- Tier 0 的规则快路径避免了对"你好"这类消息的 LLM tool_calling 开销（省 token、降延迟）
- 这直接复用了 `TravelIntentClassifier._FAST_CHAT` 的设计模式
- Tier 1 的 function calling **本身就是意图分类** — LLM 决定调不调 tool 就是在分类"简单 vs 复杂"
- 不需要单独的意图分类步骤，function calling 自然完成了分类

#### 4.4.3 与现有意图分类体系的关系

项目已有两层意图分类：

**第一层（通用）** — `domain/shared/types.py`：
```python
class IntentType(str, Enum):
    CHAT = "chat"        # 闲聊，无需工具
    QUERY = "query"      # 查询，可能需要工具
    TASK = "task"        # 任务，需要工具
    FOLLOW_UP = "follow_up"  # 追问，依赖上下文
```

**第二层（旅行领域）** — `domain/travel/intent/travel_schema.py`：
```python
class TravelIntentType(str, Enum):
    TRIP_PLANNING = "trip_planning"
    FLIGHT_SEARCH = "flight_search"
    HOTEL_SEARCH = "hotel_search"
    # ... 16 种旅行细分意图
    GENERAL_CHAT = "general_chat"
```

**云合的决策对应关系**：

| 云合决策 | 对应 IntentType | 对应行为 |
|----------|----------------|----------|
| 直接回复 | CHAT | 云合 LLM 直接回答，不调 tool |
| 直接回复 | QUERY（通用知识） | 云合 LLM 直接回答（如"什么是机器学习"） |
| 委派 | TASK | 调 delegate_to，交给专业智能体 |
| 追问 | FOLLOW_UP | 云合追问澄清意图 |
| 委派后追问 | TASK + FOLLOW_UP | 专业智能体内部处理追问 |

**关键区别**：
- 旅游 Agent 的意图分类是**域内细分**（trip_planning vs flight_search），决定调哪个工具
- 云合的决策是**跨域分类**（直接答 vs 委派给谁），决定调不调 delegate_to
- 两者是**不同层级**，不冲突：云合做第一层（给谁），专业智能体做第二层（做什么）

#### 4.4.4 云合的 system_prompt 设计

```yaml
# application/builtin_agents/yunhe.yaml
id: yunhe
name: 云合
description: >
  通用智能体。能处理日常问答、知识查询、写作等通用任务。
  遇到需要专业技能的任务时，会委派给对应的专业智能体。
  （可用智能体及其能力在运行时动态注入，无需在此列举具体领域。）
icon: "🌐"
system_prompt: |
  你是"云合"，一个通用智能体。

  ## 你的能力
  - 你可以直接回答大多数问题：闲聊、知识问答、写作、翻译、数学计算等。
  - 你无法直接调用外部工具（专业工具需依赖特定技能或 MCP 服务），这些需要委派给对应的专业智能体。

  ## 委派规则
  - 当用户的问题需要你自己不具备的专业能力时，使用 delegate_to 函数委派。具体有哪些智能体可委派，见下方"可用智能体"列表（运行时动态注入）。
  - 委派时传入智能体 ID 和用户的原始消息。
  - 拿到专业智能体的回复后，你可以直接转述，也可以补充说明或总结。
  - 如果一个问题需要多个智能体协作，可以多次调用 delegate_to。
  - 单次对话最多委派 3 次，避免无限循环。

  ## 决策原则
  - 能自己回答的，不要委派（避免不必要的开销）。
  - 不确定是否需要委派时，优先尝试自己回答。
  - 如果用户意图不明确，先追问澄清，不要盲目委派。
  - 委派后，如果专业智能体的回复不够清晰，你可以补充解释。

  ## 可用智能体
  {agent_list}  # 运行时动态注入
skills: []
mcp_servers: []
welcome_message: "你好！我是云合。日常问题可以直接问我，专业任务我会帮你找到合适的人。"
temperature: 0.7    # 通用对话，适中温度
```

**注意**：`temperature` 从 0.3 改为 0.7。原来 0.3 是因为云合只做路由（要确定性），现在云合也要做通用对话，需要适度的创造性。委派决策由 function calling 保证准确性，不依赖低温度。

#### 4.4.5 云合的 meta-tools（系统能力）

云合的"工具"不是 skill/MCP，而是**调度系统能力**。这些 tool 在 OrchestratorAgent 中直接实现，不经过 ToolRegistry：

```python
# domain/agent/orchestrator.py

YUNHE_META_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "delegate_to",
            "description": "将任务委派给专业智能体处理。当你无法直接回答、需要专业工具时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {
                        "type": "string",
                        "description": "目标智能体 ID（从可用智能体列表中选择）",
                    },
                    "message": {
                        "type": "string",
                        "description": "要委派给智能体的消息（通常是用户的原始请求）",
                    },
                },
                "required": ["agent_id", "message"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_available_agents",
            "description": "列出所有可用的专业智能体及其能力描述。不确定该委派给谁时使用。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]
```

#### 4.4.6 OrchestratorAgent 改造 — 核心逻辑

```python
# domain/agent/orchestrator.py（重构后）

class OrchestratorAgent(BaseAgent):
    """云合 — 通用智能体 + 调度者。

    核心变化：
    1. 不再靠 prompt 路由（选一个 agent 就完事）
    2. 改为 LLM function calling，云合自主决定直接回复 or 委派
    3. 云合自身可多轮对话（有 SessionManager）
    4. 支持多次委派（多智能体协作）
    """

    _MAX_DELEGATIONS = 3  # 单次对话最多委派次数，防死循环

    # Tier 0：规则快路径（复用 TravelIntentClassifier._FAST_CHAT 设计）
    _FAST_CHAT = {
        "你好", "hello", "hi", "谢谢", "thanks", "收到",
        "嗯", "哦", "哈", "嘿", "好的", "ok",
    }

    async def chat_stream(self, *, session_id, message, user_id=None, **kwargs):
        # ===== Tier 0：规则快路径 =====
        if self._is_fast_chat(message):
            # 极短闲聊，跳过 function calling，直接 LLM 回复
            async for event in self._direct_reply(session_id, message, user_id):
                yield event
            return

        # ===== Tier 1：LLM function calling =====
        delegation_count = 0
        current_message = message

        while delegation_count < self._MAX_DELEGATIONS:
            # 构建 prompt（含智能体列表）
            system_prompt = self._build_yunhe_prompt(user_id)

            # LLM 推理（带 meta-tools）
            decision = await self._llm.complete_with_tools(
                system=system_prompt,
                messages=self._build_messages(session_id, current_message),
                tools=YUNHE_META_TOOLS,
            )

            if not decision.tool_calls:
                # LLM 没有调用 tool → 直接回复（通用问答）
                async for event in self._stream_text(decision.text):
                    yield event
                break

            # ===== Tier 2：执行委派 =====
            for tool_call in decision.tool_calls:
                if tool_call.name == "delegate_to":
                    agent_id = tool_call.arguments["agent_id"]
                    delegated_message = tool_call.arguments["message"]

                    # 流式输出委派事件（前端显示"正在转接旅行规划助手..."）
                    yield {"type": "route", "data": agent_id}

                    # 执行委派
                    agent = self._get_or_create_agent(agent_id, user_id)
                    result = await agent.chat(
                        session_id=session_id,
                        message=delegated_message,
                        user_id=user_id,
                    )

                    delegation_count += 1

                    # 将委派结果作为"tool result"回传给云合 LLM
                    # 云合 LLM 决定：直接转述 / 补充说明 / 再次委派
                    current_message = f"[{agent_id} 的回复]：{result['reply']}"

                elif tool_call.name == "list_available_agents":
                    # 返回智能体列表给 LLM
                    agents_desc = self._get_all_descriptions(user_id)
                    current_message = f"[可用智能体列表]：\n{agents_desc}"

            # 继续循环，让云合 LLM 看到委派结果后做下一步决策
            # 如果 LLM 不再调用 tool，下一轮会走 break 分支

        if delegation_count >= self._MAX_DELEGATIONS:
            yield {"type": "chunk", "data": "（已达委派上限，直接返回最后一次结果）"}

    def _is_fast_chat(self, message: str) -> bool:
        """Tier 0：判断是否为极短闲聊，可跳过 function calling。"""
        stripped = message.strip().lower()
        return stripped in self._FAST_CHAT or len(stripped) <= 1

    async def _direct_reply(self, session_id, message, user_id):
        """直接 LLM 回复（不注入 tools，省 token）。"""
        system_prompt = self._build_yunhe_prompt(user_id, include_tools=False)
        reply = await self._llm.complete(
            system=system_prompt,
            messages=[{"role": "user", "content": message}],
        )
        yield {"type": "chunk", "data": reply}
        yield {"type": "done"}

    def _build_yunhe_prompt(self, user_id, include_tools=True) -> str:
        """构建云合的 system_prompt，动态注入可用智能体列表。"""
        agents_desc = self._get_all_descriptions(user_id)
        base_prompt = self._yunhe_config.system_prompt
        return base_prompt.replace("{agent_list}", agents_desc)
```

#### 4.4.7 决策流程示例

**场景 1：简单问答 → 直接回复**
```
用户："你好，你是谁？"
  → Tier 0 判断："你好" 命中 _FAST_CHAT？否（"你好，你是谁"不是极短消息）
  → Tier 1：LLM function calling
  → LLM 判断：这是通用问题，我能回答
  → LLM 不调 tool，直接回复："我是云合，一个通用智能体..."
  → 结束
```

**场景 2：专业任务 → 委派**
```
用户："帮我规划一个云南5日游"
  → Tier 0：未命中
  → Tier 1：LLM function calling
  → LLM 判断：这需要旅行规划能力，我没有旅行工具
  → LLM 调用 delegate_to("travel", "帮我规划一个云南5日游")
  → Tier 2：获取 TravelAgent，执行 chat()
  → TravelAgent 返回行程方案
  → 云合 LLM 看到结果，决定直接转述
  → 流式输出行程方案
  → 结束
```

**场景 3：多智能体协作 → 多次委派**
```
用户："帮我规划云南5日游，然后写一篇旅行日记"
  → Tier 1：LLM function calling
  → LLM 调用 delegate_to("travel", "帮我规划云南5日游")
  → Tier 2：TravelAgent 返回行程方案
  → 云合 LLM 看到行程结果，决定还需要写日记
  → LLM 再次调用 delegate_to("writer", "根据以下行程写一篇旅行日记：[行程方案]")
  → Tier 2：WriterAgent 返回旅行日记
  → 云合 LLM 看到日记，决定直接转述
  → 流式输出旅行日记
  → 结束（委派 2 次，未超上限）
```

**场景 4：意图不明 → 追问**
```
用户："帮我查一下"
  → Tier 1：LLM function calling
  → LLM 判断：意图不明确，"查什么"不清楚
  → LLM 不调 tool，直接回复："你想查什么？是航班、酒店还是天气？"
  → 结束（等待用户澄清）
```

**场景 5：通用知识问答 → 直接回复**
```
用户："什么是机器学习？"
  → Tier 1：LLM function calling
  → LLM 判断：这是通用知识问题，我能回答
  → LLM 不调 tool，直接回复："机器学习是..."
  → 结束（不需要委派）
```

#### 4.4.8 关键设计决策总结

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 意图分类方式 | LLM function calling 自然完成 | 不需要单独分类步骤，LLM 调不调 tool 就是分类 |
| 快路径 | 规则匹配极短消息 | 省 token、降延迟，复用 TravelIntentClassifier 模式 |
| temperature | 0.7 | 云合要做通用对话，不能太死板；委派准确性靠 function calling 保证 |
| 委派上限 | 3 次 | 防死循环，覆盖绝大多数多智能体协作场景 |
| 委派结果处理 | 回传 LLM 让云合决定 | 云合可以补充说明、总结、或再次委派 |
| 会话记忆 | 云合有自己的 SessionManager | 多轮对话上下文（如用户追问"刚才那个方案再改一下"） |

#### 4.4.9 委派上下文与子智能体追问问题

**问题描述**：

当云合委派后，子智能体可能需要追问用户（如"从哪出发？几个人？"）。此时：

```
用户："帮我规划云南5日游"
  → 云合委派给旅行智能体
  → 旅行智能体："请问从哪个城市出发？"
  → 云合转发给用户
用户："从南昌出发，3个人"
  → ❌ 这条消息回到云合，云合需要重新做意图分类
  → ❌ "从南昌出发，3个人"可能被误判为新任务，再次走 delegate_to
  → ❌ 之前的对话上下文丢失！
```

**方案对比**：

| 维度 | 方案 A：委派前参数检查 | 方案 B：委派上下文（推荐） |
|------|----------------------|--------------------------|
| 核心思路 | 委派前，云合检查用户消息是否包含所有必需参数，缺了就追问 | 委派后，用户消息直接转发给当前智能体，跳过意图分类 |
| 领域知识 | ❌ 云合需要知道每个智能体的参数需求 | ✅ 云合不需要任何领域知识 |
| 代码复用 | ❌ 重复实现 missing_info 检测 | ✅ 复用智能体已有的 missing_info 机制 |
| 参数动态性 | ❌ 国际/国内旅行参数不同，难维护 | ✅ 智能体自己处理动态参数 |
| 用户体验 | ⚠️ 先在云合处回答问题，再被转到智能体 | ✅ 直接和智能体对话，自然流畅 |
| 可扩展性 | ❌ 每加一个智能体，云合要加一套参数检查 | ✅ 新智能体即插即用，云合无感知 |

**方案 B：委派上下文 + 交接协议（推荐）**

核心思路：**一旦委派，用户消息直接转发给当前智能体，跳过意图分类。智能体自己判断是否需要追问、何时完成任务。**

```
State 1: IDLE（无活跃委派）
  用户消息 → 云合正常决策（Tier 0 快路径 / Tier 1 function calling）
  → 委派时：设置委派上下文，进入 State 2

State 2: DELEGATED（有活跃委派）
  用户消息 → 直接转发给当前委派的智能体（跳过 Tier 0/1）
  智能体返回 status:
    ├─ "final_answer"：任务完成 → 清除委派上下文，回到 State 1，云合转述结果
    ├─ "need_input"：需要用户补充信息 → 云合转发问题给用户，保持 State 2
    └─ "cannot_handle"：无法处理（如用户切换话题）→ 清除委派上下文，云合接手回到 State 1
```

**数据结构**：

```python
# domain/agent/orchestrator.py

from dataclasses import dataclass
import time

@dataclass
class DelegationContext:
    """委派上下文 — 跟踪当前会话的活跃委派状态。"""
    agent_id: str
    status: str  # "active" | "completed" | "released"
    started_at: float
    last_interaction: float
    delegation_count: int = 0  # 本轮对话中委派次数

    def is_active(self) -> bool:
        return self.status == "active"

    def touch(self):
        self.last_interaction = time.time()


class OrchestratorAgent(BaseAgent):
    # 委派上下文：session_id -> DelegationContext
    _delegation_contexts: dict[str, DelegationContext] = {}

    # 委派超时（秒），超时后自动释放
    _DELEGATION_TIMEOUT = 1800  # 30 分钟

    async def chat_stream(self, *, session_id, message, user_id=None, **kwargs):
        # ===== 检查是否有活跃的委派上下文 =====
        ctx = self._delegation_contexts.get(session_id)
        if ctx and ctx.is_active() and not self._is_delegation_expired(ctx):
            # 有活跃委派 → 直接转发给当前智能体（跳过 Tier 0/1）
            async for event in self._forward_to_delegated_agent(ctx, session_id, message, user_id):
                yield event
            return

        # 无活跃委派 → 正常 Tier 0/1/2 决策
        async for event in self._normal_decision_flow(session_id, message, user_id):
            yield event

    async def _forward_to_delegated_agent(self, ctx, session_id, message, user_id):
        """将用户消息直接转发给当前委派的智能体。"""
        agent = self._get_or_create_agent(ctx.agent_id, user_id)
        result = await agent.chat(
            session_id=session_id,
            message=message,
            user_id=user_id,
        )

        ctx.touch()

        # 根据智能体返回的 status 决定下一步
        status = result.get("status", "final_answer")

        if status == "final_answer":
            # 任务完成 → 清除委派上下文
            ctx.status = "completed"
            del self._delegation_contexts[session_id]
            yield {"type": "chunk", "data": result["reply"]}
            yield {"type": "done"}

        elif status == "need_input":
            # 需要用户补充信息 → 保持委派上下文
            yield {"type": "chunk", "data": result["reply"]}
            yield {"type": "need_input", "data": result.get("missing_info", [])}
            yield {"type": "done"}

        elif status == "cannot_handle":
            # 智能体无法处理（如用户切换话题）→ 释放委派，云合接手
            del self._delegation_contexts[session_id]
            # 云合重新处理这条消息
            async for event in self._normal_decision_flow(session_id, message, user_id):
                yield event

    def _set_delegation(self, session_id: str, agent_id: str):
        """设置委派上下文。"""
        self._delegation_contexts[session_id] = DelegationContext(
            agent_id=agent_id,
            status="active",
            started_at=time.time(),
            last_interaction=time.time(),
        )

    def _is_delegation_expired(self, ctx: DelegationContext) -> bool:
        """检查委派是否超时。"""
        return time.time() - ctx.last_interaction > self._DELEGATION_TIMEOUT
```

**智能体侧的交接协议**：

BaseAgent 的 `chat()` 返回值需要增加 `status` 字段：

```python
# domain/agent/base.py

class BaseAgent(ABC):
    async def chat(self, *, session_id, message, user_id=None, **kwargs) -> dict:
        """
        返回值格式：
        {
            "status": "final_answer" | "need_input" | "cannot_handle",
            "reply": "回复内容",
            "missing_info": ["destination", "dates"],  # 仅 need_input 时
        }
        """
        ...

    def _check_in_scope(self, message: str) -> bool:
        """检查消息是否在当前智能体的处理范围内。
        用于判断是否应该释放控制权回云合。
        """
        return True  # 默认总是处理
```

**旅游 Agent 的实现**：

旅游 Agent 已有 `TravelIntentClassifier`，可以直接利用：

```python
# domain/agent/travel_agent.py

class TravelAgent(BaseAgent):
    async def chat(self, *, session_id, message, user_id=None, **kwargs) -> dict:
        # 1. 意图分类
        ops_result = await self._ops_classifier.classify(message)

        # 2. 检查是否在范围内
        if ops_result.intent == TravelIntentType.GENERAL_CHAT:
            # 判断是否明显不相关（如"讲个笑话"、"写代码"）
            if self._is_clearly_off_topic(message):
                return {
                    "status": "cannot_handle",
                    "reply": "这个问题超出了我的专业范围，已为您转回云合。",
                }

        # 3. 检查缺失信息（复用现有 check_missing_info_with_context）
        missing = await self._ops_classifier.check_missing_info_with_context(
            message, ops_result.intent, conversation_history=...
        )
        if missing:
            return {
                "status": "need_input",
                "reply": f"请补充以下信息：{', '.join(missing)}",
                "missing_info": missing,
            }

        # 4. 正常处理
        result = await self._agent.chat(...)
        return {
            "status": "final_answer",
            "reply": result["reply"],
        }

    def _is_clearly_off_topic(self, message: str) -> bool:
        """判断消息是否明显与旅行无关。"""
        off_topic_keywords = ["写代码", "编程", "算法", "翻译", "数学题", "讲个笑话"]
        return any(kw in message for kw in off_topic_keywords)
```

**完整流程示例**：

```
用户："帮我规划云南5日游"
  → State 1 (IDLE)
  → Tier 1: LLM 调用 delegate_to("travel", "帮我规划云南5日游")
  → 设置委派上下文: session → DelegationContext(agent_id="travel")
  → 转发给 TravelAgent
  → TravelAgent: intent=TRIP_PLANNING, missing=["origin"]
  → 返回 status="need_input", reply="请问从哪个城市出发？"
  → 云合转发给用户，保持 State 2

用户："从南昌出发，3个人"
  → State 2 (DELEGATED)
  → ⚡ 跳过 Tier 0/1，直接转发给 TravelAgent
  → TravelAgent: intent=TRIP_PLANNING, missing=[] (信息完整)
  → 执行 ReAct 循环，调用旅行工具
  → 返回 status="final_answer", reply="为您规划了云南5日游方案..."
  → 清除委派上下文，回到 State 1
  → 云合转述结果

用户："这个方案不错，再帮我查一下机票"
  → State 1 (IDLE)
  → Tier 1: LLM 调用 delegate_to("travel", "查一下机票")
  → 新一轮委派...
```

**话题切换处理**：

```
用户（在旅行委派中）："算了，我想问一下什么是机器学习"
  → State 2 (DELEGATED)
  → 转发给 TravelAgent
  → TravelAgent: intent=GENERAL_CHAT, _is_clearly_off_topic=True
  → 返回 status="cannot_handle"
  → 清除委派上下文，云合接手
  → 云合 Tier 1: LLM 不调 tool，直接回复"机器学习是..."
```

#### 4.4.10 委派上下文的持久化

委派上下文需要持久化到 DB，避免服务重启后丢失：

```sql
-- sessions 表新增委派状态字段
ALTER TABLE sessions ADD COLUMN delegation_agent_id TEXT DEFAULT NULL;
ALTER TABLE sessions ADD COLUMN delegation_started_at REAL DEFAULT NULL;
ALTER TABLE sessions ADD COLUMN delegation_last_interaction REAL DEFAULT NULL;
```

```python
# domain/user/session/manager.py

class SessionManager:
    def get_delegation(self, session_id: str) -> DelegationContext | None:
        """从 DB 读取委派上下文。"""
        ...

    def set_delegation(self, session_id: str, agent_id: str):
        """写入委派上下文到 DB。"""
        ...

    def clear_delegation(self, session_id: str):
        """清除委派上下文。"""
        ...
```

### 4.5 Function Call 架构设计

#### 4.5.1 三层 Function Call 分类

```
┌─────────────────────────────────────────────────────────────┐
│                    Function Call 全景图                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  Layer 1    │  │  Layer 2    │  │  Layer 3    │         │
│  │  云合独有    │  │  子智能体独有 │  │  通用共享    │         │
│  │  (调度层)   │  │  (渐进披露)  │  │  (基础能力)  │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                  │
│  delegate_to       load_skill_detail   recall_memory        │
│  list_agents       load_mcp_info       get_current_time     │
│  recall_delegation load_mcp_tool       request_confirmation │
│                    [domain tools]      http_request         │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  云合 = Layer 1 + Layer 3                                    │
│  子智能体 = Layer 2 + Layer 3                                │
└─────────────────────────────────────────────────────────────┘
```

#### 4.5.2 Layer 1：云合独有 function calls

| 函数名 | 用途 | 参数 |
|--------|------|------|
| `delegate_to` | 将任务委派给专业智能体 | `agent_id`, `message` |
| `list_available_agents` | 列出可用智能体及简要描述 | 无 |
| `recall_delegation` | 主动召回委派，接管对话 | `reason`（可选） |

**设计要点**：
- `list_available_agents` 只返回**一级摘要**（id + name + 一句话描述），不返回完整能力描述
- 云合的 system_prompt 中已注入智能体列表，`list_available_agents` 是 LLM 主动查询的补充手段
- `recall_delegation` 用于云合判断委派方向错误时主动召回（如发现用户意图变了）

#### 4.5.3 Layer 2：子智能体独有 function calls（渐进式披露）

这是本设计的核心。当前系统 `_build_tools_schema` 全量注入所有工具 schema，在工具数量多时会导致：
1. **Token 浪费**：每个工具 schema ~200-500 tokens，20 个工具就是 4K-10K tokens
2. **LLM 困惑**：选项太多，工具选择准确率下降
3. **推理变慢**：输入 token 多，推理延迟增加

**渐进式披露三级模型**：

```
Level 0（始终在 prompt 中）：名称 + 一句话摘要
  "可用技能：fliggy-travel（航班酒店查询）、amap（地图导航）"
  "可用 MCP：web-search（网页搜索）"
  "如需使用，先调用 load_skill_detail 或 load_mcp_info 获取详细用法"

       ↓ LLM 判断需要用某个技能/MCP，主动调用

Level 1（按需拉取）：详细描述 + 工具列表
  load_skill_detail("fliggy-travel")
  → "fliggy-travel 提供航班和酒店查询。
     可用工具：fliggy_search_flights, fliggy_search_hotels。
     如需调用，先 load_mcp_tool_detail 获取参数。"

       ↓ LLM 知道有哪些工具了，拉取具体工具的参数 schema

Level 2（按需拉取）：完整工具 schema
  load_tool_detail("fliggy_search_flights")
  → {name, description, parameters: {origin, destination, date, ...}}

       ↓ LLM 有了完整参数，直接调用工具

Level 3（执行）：工具实际执行
  fliggy_search_flights(origin="北京", destination="上海", date="2024-01-15")
  → 返回搜索结果
```

| 函数名 | 用途 | 参数 | 返回 |
|--------|------|------|------|
| `load_skill_detail` | 拉取技能详细描述和工具列表 | `skill_name` | 详细描述 + 工具名列表 |
| `load_mcp_info` | 拉取 MCP server 连接方式和工具列表 | `server_id` | 连接说明 + 工具名列表 |
| `load_tool_detail` | 拉取工具的完整参数 schema | `tool_name` | 完整 ToolSpec（含 parameters） |

**关键设计**：
- Level 0 的摘要始终在 system_prompt 中（几十 tokens，不随工具数量膨胀）
- Level 1-2 是 LLM 主动调用的 function call，按需拉取
- Level 3 的工具 schema **不预先注入** LLM 的 native tools 列表，而是在 Level 2 拉取后动态注册

**实现机制**：

```python
# domain/reasoning/engine.py 改造

class ReasoningEngine:
    def _build_tools_schema(self, disclosed_tools: set[str] | None = None) -> list[dict]:
        """构建传给 LLM 的 native tools schema。

        改造点：只包含 disclosed_tools 中的工具 + 渐进披露工具本身。
        不再遍历全 registry。
        """
        schemas = []

        # 1. 始终包含渐进披露工具（Level 0 → 1 → 2 的拉取工具）
        schemas.append(LOAD_SKILL_DETAIL_SCHEMA)
        schemas.append(LOAD_MCP_INFO_SCHEMA)
        schemas.append(LOAD_TOOL_DETAIL_SCHEMA)

        # 2. 已披露的领域工具（Level 3：实际可执行的工具）
        if disclosed_tools:
            for tool_name in disclosed_tools:
                tool = self._registry.get(tool_name)
                if tool:
                    schemas.append(tool.spec.to_openai_schema())

        return schemas

    async def run(self, ...):
        disclosed: set[str] = session_state.get("disclosed_tools", set())

        for iteration in range(max_iterations):
            tools_schema = self._build_tools_schema(disclosed)
            response = await self._llm.complete_with_tools(
                system=system_prompt,
                messages=messages,
                tools=tools_schema,
            )

            for tool_call in response.tool_calls:
                if tool_call.name == "load_tool_detail":
                    # 拉取工具 schema → 加入已披露集合
                    detail = self._get_tool_detail(tool_call.arguments["tool_name"])
                    disclosed.add(tool_call.arguments["tool_name"])
                    session_state["disclosed_tools"] = disclosed
                    # 返回详细 schema 给 LLM，下一轮该工具会出现在 native tools 中
                    messages.append({"role": "tool", "content": json.dumps(detail)})

                elif tool_call.name in disclosed:
                    # 已披露的工具，直接执行
                    result = await self._executor.execute(tool_call.name, tool_call.arguments)
                    messages.append({"role": "tool", "content": json.dumps(result)})

                # ... 其他工具处理
```

#### 4.5.4 Layer 3：通用共享 function calls

这些是云合和子智能体**都需要的**基础能力：

| 函数名 | 用途 | 云合需要 | 子智能体需要 | 参数 |
|--------|------|---------|-------------|------|
| `recall_memory` | 检索记忆/历史对话 | ✅ 记住用户偏好 | ✅ 记住用户偏好 | `query`, `scope` |
| `get_current_time` | 获取当前时间 | ✅ 时间推理 | ✅ 日期相关任务 | `timezone`（可选） |
| `request_confirmation` | 请求用户确认高风险操作 | ❌ | ✅ 危险操作前 | `action`, `risk_level`, `details` |
| `http_request` | 通用 HTTP 请求 | ❌ | ✅ 调用外部 API | `method`, `url`, `headers`, `body` |

**为什么这些是共享的？**

- `recall_memory`：云合需要记住"用户上次让旅行智能体规划过云南行程"，子智能体需要记住"用户偏好经济舱"
- `get_current_time`：任何时间相关的推理都需要（"今天几号"、"下周六是哪天"）
- `request_confirmation`：云合不执行工具所以不需要，但所有执行工具的子智能体都需要（如支付、删除、修改操作）
- `http_request`：通用 HTTP 工具，子智能体可以用它调用未预置的 API

**为什么不共享 `save_memory`？**
- 记忆保存是**自动的**（由 `MemoryExtractor` + `MemoryDistiller` 在对话后自动提取），不需要 LLM 显式决定
- 如果让 LLM 决定保存什么，反而会保存无用信息或遗漏重要信息

#### 4.5.5 ToolSpec 扩展

当前 `ToolSpec` 只有 4 个字段（name/description/category/parameters），需要扩展支持渐进式披露：

```python
# infrastructure/tools/base.py

@dataclass
class ToolSpec:
    name: str
    description: str           # 完整描述（Level 2）
    category: str
    parameters: dict | None

    # === 新增：渐进式披露字段 ===
    short_description: str = ""     # 一句话摘要（Level 0），默认取 description 前 50 字
    disclosure_keywords: list[str] = field(default_factory=list)  # 关键词匹配，用于自动推荐
    confirm_required: bool = False  # 是否需要用户确认（高风险工具）
    tier: str = "standard"          # "core"（始终披露）| "standard"（按需披露）| "advanced"（需确认后披露）
    skill_binding: str = ""         # 该工具属于哪个 skill（用于 skill → tool 映射）
    mcp_source: str = ""            # 该工具来自哪个 MCP server

    def to_summary(self) -> str:
        """Level 0 摘要：name + short_description"""
        return f"- {self.name}: {self.short_description or self.description[:50]}"

    def to_openai_schema(self) -> dict:
        """Level 2 完整 schema：传给 LLM 的 native tool 定义"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters or {"type": "object", "properties": {}},
            },
        }
```

#### 4.5.6 渐进式披露的自动推荐

除了 LLM 主动调用 `load_skill_detail`，系统还应根据用户消息**自动推荐**相关工具：

```python
# domain/reasoning/tool_selector.py（新建）

class ToolSelector:
    """根据用户消息和上下文，自动推荐应披露的工具。

    复用 MCPCatalog.select_tool_refs 的打分机制，推广到所有工具类别。
    """

    def select(self, message: str, all_specs: list[ToolSpec],
               already_disclosed: set[str], limit: int = 3) -> list[ToolSpec]:
        """选择 top-N 相关工具，排除已披露的。"""
        scored = []
        for spec in all_specs:
            if spec.name in already_disclosed:
                continue
            score = self._score(spec, message)
            if score > 0:
                scored.append((score, spec))
        scored.sort(key=lambda x: -x[0])
        return [s for _, s in scored[:limit]]

    def _score(self, spec: ToolSpec, message: str) -> int:
        score = 0
        msg_lower = message.lower()
        # 工具名命中
        if spec.name.lower() in msg_lower:
            score += 8
        # 披露关键词命中
        for kw in spec.disclosure_keywords:
            if kw.lower() in msg_lower:
                score += 4
        # category 命中
        if spec.category.lower() in msg_lower:
            score += 2
        return score
```

**双轨披露机制**：
1. **自动推荐**（被动）：每轮根据用户消息自动推荐 top-3 相关工具加入 `disclosed` 集合
2. **主动拉取**（主动）：LLM 通过 `load_skill_detail` / `load_tool_detail` 主动拉取

### 4.6 产品级补充设计（成本/安全/体验）

> **定位说明**：本节为产品稳定与体验设计。社区分享版取其中**成本控制、安全策略、错误处理、UX** 部分；可观测性中的独立 Metrics 系统为可选。纯商用 SaaS 内容（多租户/计费/RBAC/GDPR）见 4.7 节，社区版不做。

#### 4.6.1 成本控制

| 机制 | 说明 | 配置项 |
|------|------|--------|
| Token 预算 | 每次对话的 token 总量上限 | `max_tokens_per_conversation: 50000` |
| 工具调用上限 | 每次对话的工具调用次数上限 | `max_tool_calls: 20` |
| 迭代上限 | ReAct 循环最大迭代数（已有） | `max_iterations: 15` |
| 委派上限 | 单次对话最大委派次数（已有） | `_MAX_DELEGATIONS: 3` |
| 渐进披露上限 | 每轮最多自动推荐工具数 | `max_auto_disclose: 3` |
| LLM 超时 | 单次 LLM 调用超时 | `llm_timeout: 30` |

```python
@dataclass
class CostGuard:
    """成本守卫 — 在 ReAct 循环中检查预算。"""
    token_budget: int = 50000
    tokens_used: int = 0
    tool_calls_used: int = 0
    max_tool_calls: int = 20

    def can_continue(self) -> bool:
        return (self.tokens_used < self.token_budget
                and self.tool_calls_used < self.max_tool_calls)

    def consume(self, tokens: int, tool_call: bool = False):
        self.tokens_used += tokens
        if tool_call:
            self.tool_calls_used += 1
```

#### 4.6.2 安全与策略

```
┌──────────────────────────────────────────────┐
│              工具执行安全链路                   │
├──────────────────────────────────────────────┤
│                                              │
│  LLM 决定调用工具                              │
│       ↓                                      │
│  ① 输入校验（参数类型/范围/格式）               │
│       ↓                                      │
│  ② 策略检查（ToolPolicy: ALLOW/DENY/CONFIRM） │
│       ↓                                      │
│  ③ 频率检查（RateLimiter: 每分钟/每小时/每天） │
│       ↓                                      │
│  ④ 权限检查（用户是否有权调用此工具）            │
│       ↓                                      │
│  ⑤ 执行工具                                    │
│       ↓                                      │
│  ⑥ 输出过滤（脱敏/裁剪/格式化）                 │
│       ↓                                      │
│  返回结果给 LLM                                │
│                                              │
└──────────────────────────────────────────────┘
```

```python
# infrastructure/tools/policy.py 扩展

class ToolPolicy:
    def check(self, tool_name: str, arguments: dict,
              user_id: str, agent_id: str) -> PolicyDecision:
        # ① 输入校验
        spec = self._registry.get_spec(tool_name)
        if not self._validate_arguments(spec, arguments):
            return PolicyDecision(DENY, "参数校验失败")

        # ② 策略检查（原有逻辑 + confirm_required 联动）
        if spec.confirm_required:
            return PolicyDecision(CONFIRM, f"工具 {tool_name} 需要用户确认")

        # ③ 频率检查
        if not self._rate_limiter.allow(user_id, tool_name):
            return PolicyDecision(DENY, "调用频率超限")

        # ④ 权限检查
        if not self._permission_checker.has_access(user_id, agent_id, tool_name):
            return PolicyDecision(DENY, "无权调用此工具")

        return PolicyDecision(ALLOW, "")
```

#### 4.6.3 错误处理与降级

```python
# domain/reasoning/engine.py

class ReasoningEngine:
    async def _execute_tool_safely(self, tool_name, arguments, context):
        """安全执行工具，带完整的错误处理。"""
        try:
            # 策略检查
            decision = self._policy.check(tool_name, arguments, ...)
            if decision.decision == DENY:
                return {"error": "denied", "reason": decision.reason}
            if decision.decision == CONFIRM:
                # 暂停执行，请求用户确认
                return {
                    "status": "need_confirmation",
                    "action": tool_name,
                    "details": arguments,
                }

            # 执行
            result = await self._executor.execute(tool_name, arguments)

            # 输出过滤
            return self._filter_output(tool_name, result)

        except TimeoutError:
            return {"error": "timeout", "tool": tool_name}
        except ConnectionError:
            return {"error": "connection_failed", "tool": tool_name}
        except Exception as e:
            logger.error("Tool execution failed: %s: %s", tool_name, e)
            return {"error": "execution_failed", "tool": tool_name, "message": str(e)}
```

**错误恢复策略**：

| 错误类型 | LLM 收到的信息 | LLM 可能的决策 |
|----------|--------------|--------------|
| 工具超时 | `{"error": "timeout"}` | 重试 / 换工具 / 告诉用户 |
| 连接失败 | `{"error": "connection_failed"}` | 重试 / 换工具 / 降级处理 |
| 参数校验失败 | `{"error": "invalid_params", "details": ...}` | 修正参数重试 |
| 频率超限 | `{"error": "rate_limited"}` | 等待 / 告诉用户稍后重试 |
| 需要确认 | `{"status": "need_confirmation"}` | 向用户请求确认 |
| 权限不足 | `{"error": "forbidden"}` | 告诉用户无权限 |

#### 4.6.4 可观测性

```
┌──────────────────────────────────────────────────┐
│                  可观测性三支柱                      │
├──────────────────────────────────────────────────┤
│                                                  │
│  ① 审计日志 (AuditLogger)                         │
│     · 每次工具调用的输入/输出/耗时/结果              │
│     · 每次委派的 agent_id / message / 结果          │
│     · 每次意图分类的结果                             │
│     · 用户确认/拒绝操作                             │
│                                                  │
│  ② 指标 (Metrics)                                 │
│     · tool_calls_total{tool, status}              │
│     · llm_tokens_used{agent, type}                │
│     · delegation_count{from, to}                  │
│     · response_latency{agent, p50, p99}           │
│     · error_rate{tool, type}                      │
│                                                  │
│  ③ 链路追踪 (TraceStore)                           │
│     · RunTrace: 完整的 ReAct 迭代链路               │
│     · TraceStep: 每轮的 decision / tool_call       │
│     · 委派链路: 云合 → 子智能体 → 工具执行           │
│                                                  │
└──────────────────────────────────────────────────┘
```

#### 4.6.5 用户体验

| 场景 | 前端展示 | 后端事件 |
|------|---------|---------|
| 云合决定委派 | "正在为您转接旅行规划助手..." | `{"type": "route", "agent_id": "travel"}` |
| 工具执行中 | "正在搜索航班..." + 加载动画 | `{"type": "tool_start", "tool": "fliggy_search"}` |
| 工具执行完成 | 工具结果卡片 | `{"type": "tool_result", "tool": "...", "data": ...}` |
| 需要用户确认 | 确认对话框 | `{"type": "need_confirmation", "action": "...", "details": ...}` |
| 需要补充信息 | 智能体追问气泡 | `{"type": "need_input", "missing": ["出发地"]}` |
| 错误发生 | 友好错误提示 | `{"type": "error", "message": "搜索服务暂时不可用"}` |
| 任务完成 | 最终回复 + 行动卡片 | `{"type": "done", "reply": "..."}` |

### 4.7 商用场景全景（业务层面，远期参考）

> **定位说明**：本节为**面向未来商用化**的远期参考设计，**社区分享版暂不实现**。
> 若产品未来从社区分享转向商用 SaaS，再按本节内容补齐多租户、计费、RBAC、合规等能力。
> 保留本节是为了让架构设计不留盲区，确保当前架构在未来可平滑扩展。

#### 4.7.1 多租户与组织隔离

商用产品需要支持个人、团队、企业三级使用场景：

| 租户层级 | 特征 | 隔离要求 |
|----------|------|---------|
| 个人用户 | 独立账号，私有智能体/记忆 | 用户间数据完全隔离 |
| 团队 | 共享部分智能体和 MCP 配置 | 团队内共享 + 团队间隔离 |
| 企业 | 组织级智能体市场、统一计费、SSO | 组织隔离 + 管理员权限 |

**数据模型扩展**：

```python
# AgentConfig 进一步扩展（在 4.1.1 基础上）
@dataclass
class AgentConfig:
    # ... 已有字段 ...
    owner_type: str = "user"        # "user" | "team" | "org"
    owner_id: str = ""              # user_id / team_id / org_id
    visibility: str = "private"     # "private" | "team" | "public"
    allowed_user_ids: list[str] = field(default_factory=list)  # 显式授权列表
```

**隔离策略**：
- 查询智能体列表时，按 `owner_type` + `owner_id` + `visibility` 过滤
- 记忆数据按 `user_id` + `session_id` 严格隔离，跨用户查询必须显式授权
- MCP server 配置可标记为 `org_shared`，团队内共享连接凭据但不共享会话

**当前缺口**：现有 `custom_agents` 表只有 `user_id`，无组织/团队概念。Phase 4 需扩展。

#### 4.7.2 计费与配额体系

商用产品的核心商业模式依赖用量计费：

| 计费维度 | 说明 | 配置示例 |
|----------|------|---------|
| Token 用量 | LLM 输入+输出 token 总量 | `plan_limits.free: 100K tokens/月` |
| 工具调用次数 | MCP/skill 工具调用计数 | `plan_limits.free: 500 calls/月` |
| 委派次数 | 云合委派给子智能体的次数 | `plan_limits.pro: 1000 delegations/月` |
| 智能体数量 | 用户可创建的自定义智能体上限 | `plan_limits.free: 3 agents` |
| 会话历史 | 保留的会话天数 | `plan_limits.free: 7 days` |
| 记忆容量 | 存储的记忆条数 | `plan_limits.free: 100 memories` |

**配额执行链路**：

```
用户请求 → QuotaGuard.check(user_id, resource_type)
              ↓
         ┌─ 配额未超限 → 放行
         └─ 配额已超限 → 返回 429 + 升级提示
              ↓
         记录用量到 usage_log 表
              ↓
         接近上限时（80%/90%）→ 前端预警提示
```

**实现要点**：
- 新建 `domain/billing/quota_guard.py`，在 `ReasoningEngine` 和 `OrchestratorAgent` 入口处拦截
- `usage_log` 表记录：`user_id, resource_type, amount, agent_id, session_id, timestamp`
- 前端在 NavSidebar 用户区显示当月用量进度条

**当前缺口**：无任何计费/配额基础设施。Phase 4 新建。

#### 4.7.3 内容安全与合规

LLM 产品面临多重内容安全风险：

| 风险类型 | 场景 | 防御措施 |
|----------|------|---------|
| **输入有害内容** | 用户输入涉政/暴力/色情 | 输入 moderation API 拦截 |
| **输出有害内容** | LLM 生成不当内容 | 输出 moderation + 关键词过滤 |
| **Prompt 注入** | 用户试图篡改 system_prompt | 输入消毒 + system_prompt 隔离 |
| **PII 泄露** | LLM 输出中包含用户隐私 | 输出 PII 检测 + 脱敏 |
| **工具滥用** | 通过 http_request 访问内网 | URL 白名单 + SSRF 防护 |
| **数据投毒** | 记忆被污染导致后续行为异常 | 记忆写入校验 + 异常检测 |

**Prompt 注入防御**（重点）：

```python
# domain/safety/prompt_guard.py（新建）

class PromptGuard:
    """输入消毒层 — 在用户消息进入 LLM 前过滤。"""

    INJECTION_PATTERNS = [
        r"ignore\s+(previous|above|all)\s+instructions",
        r"forget\s+(your|the)\s+(system|previous)\s+prompt",
        r"you\s+are\s+now\s+(a|an)\s+",  # 角色劫持
        r"</(system|assistant)>",  # 标签注入
    ]

    def sanitize(self, message: str) -> tuple[str, list[str]]:
        """返回消毒后的消息 + 触发的警告列表。"""
        warnings = []
        for pattern in self.INJECTION_PATTERNS:
            if re.search(pattern, message, re.IGNORECASE):
                warnings.append(f"检测到可疑模式: {pattern}")
        # 不直接拦截，而是标记后让 LLM 在隔离的 user 消息中处理
        return message, warnings
```

**system_prompt 隔离原则**：
- system_prompt 永远在 messages 数组的第一个 `{"role": "system"}` 中
- 用户输入永远作为 `{"role": "user"}` 传入，不拼接到 system 中
- 工具结果作为 `{"role": "tool"}` 传入，与 user 消息区分

**合规要求**（按地区）：
- 中国：PIPL（《个人信息保护法》）— 数据本地存储、明确同意、可删除
- 欧洲：GDPR — 被遗忘权、数据可携带权、DPA 协议
- 美国：CCPA — 用户有权知道数据被如何使用

**当前缺口**：无内容安全层。Phase 4 新建 `domain/safety/` 模块。

#### 4.7.4 用户认证与授权（RBAC）

商用产品需要精细的权限控制：

| 角色 | 权限 | 适用场景 |
|------|------|---------|
| `viewer` | 浏览公共智能体、只读对话 | 社区访客 |
| `user` | 创建私有智能体、使用公共 MCP | 免费用户 |
| `power_user` | 创建团队共享智能体、配置团队 MCP | Pro 用户 |
| `admin` | 管理组织成员、审批公共智能体、查看组织用量 | 企业管理员 |
| `system` | 系统级操作（MCP 配置、全局策略） | 运维 |

**权限矩阵**：

```
              创建智能体  删除智能体  使用MCP  配置MCP  查看用量  管理成员
viewer          ❌          ❌        ❌       ❌       ❌        ❌
user            ✅(私有)    ✅(自己)   ✅       ❌       ✅(自己)   ❌
power_user      ✅(团队)    ✅(团队)   ✅       ✅(团队)  ✅(团队)   ❌
admin           ✅(组织)    ✅(组织)   ✅       ✅(组织)  ✅(组织)   ✅
```

**API 鉴权链路**：

```
请求 → JWT 解析 → 提取 user_id + role + org_id
         ↓
      PermissionGuard.check(user, resource, action)
         ↓
      ┌─ 允许 → 处理请求
      └─ 拒绝 → 403 Forbidden
```

**当前缺口**：现有 `verify_token` 只做身份验证（who are you），无权限检查（can you do this）。Phase 4 扩展。

#### 4.7.5 智能体生命周期管理

商用产品中智能体不是"创建即永久"，需要完整生命周期：

```
草稿(draft) → 发布(published) → 版本迭代(versioned) → 归档(archived) → 删除(deleted)
                 ↑                    ↓
                 └── 回滚(rollback) ──┘
```

| 生命周期阶段 | 说明 | 数据状态 |
|-------------|------|---------|
| draft | 编辑中，仅创建者可见 | `status: "draft"` |
| published | 正式可用，对授权用户可见 | `status: "published"` |
| versioned | 每次发布生成版本快照 | `agent_versions` 表 |
| archived | 停用但保留历史会话 | `status: "archived"`，新会话拒绝 |
| deleted | 软删除，30天后物理清除 | `status: "deleted"`，`deleted_at` |

**版本管理**：

```sql
-- agent_versions 表
CREATE TABLE agent_versions (
    version_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    config_snapshot TEXT NOT NULL,  -- 完整 AgentConfig JSON
    changelog TEXT,
    published_by TEXT,
    published_at TEXT,
    is_current BOOLEAN DEFAULT FALSE
);
```

**A/B 测试**：企业用户可让同一智能体运行两个版本，按用户 hash 分流，对比效果指标（完成率、满意度）。

**智能体市场**（社区版）：
- 用户可将私有智能体发布到社区市场
- 市场智能体经过审核（内容安全 + 工具安全性检查）后上架
- 其他用户可"克隆"市场智能体到自己的工作区
- 原作者可获得使用量统计

**当前缺口**：无版本管理、无市场。Phase 5 扩展。

#### 4.7.6 数据治理与隐私保护

商用产品必须满足数据生命周期管理：

| 数据类型 | 保留策略 | 用户权利 |
|----------|---------|---------|
| 会话记录 | 按套餐保留（免费7天/Pro 90天/企业自定义） | 查看、导出、删除 |
| 记忆数据 | 持久存储，用户可管理 | 查看、编辑、删除单条、清空 |
| 智能体配置 | 持久存储 | 导出、导入、删除 |
| 用量日志 | 90天（用于计费争议） | 查看用量明细 |
| 审计日志 | 180天（合规要求） | 管理员可查看 |

**被遗忘权实现**（GDPR/PIPL）：

```python
# api/server.py
DELETE /api/account/data  # 删除用户所有数据
DELETE /api/memory/{memory_id}  # 删除单条记忆
DELETE /api/sessions/{session_id}  # 删除单个会话
GET  /api/account/export  # 导出用户所有数据（JSON）
```

**数据导出格式**：包含所有会话、记忆、智能体配置、用量记录，符合数据可携带权。

**当前缺口**：无数据导出 API、无批量删除 API。Phase 4 新增。

#### 4.7.7 高可用与弹性扩展

商用产品需要保障 SLA（建议 99.9% 可用性）：

| 层级 | 风险 | 措施 |
|------|------|------|
| LLM 调用 | OpenAI API 限流/宕机 | 多 provider fallback（OpenAI → Azure → 本地模型） |
| MCP server | 外部服务不可用 | 超时 + 降级策略 + 健康检查 |
| 数据库 | SQLite 单点故障 | 商用版迁移 PostgreSQL + 读写分离 |
| 会话状态 | 进程重启丢失 | 委派上下文持久化到 DB（4.4.10 已设计） |
| 全局限流 | 恶意请求刷量 | 按 user_id + IP 双维度限流 |

**LLM Provider 降级链**：

```python
# infrastructure/llm/fallback.py（新建）

class FallbackLLM:
    """多 LLM provider 降级链。"""

    def __init__(self, providers: list[OpenAILLM]):
        self._providers = providers  # 按优先级排序

    async def complete_with_tools(self, **kwargs):
        for provider in self._providers:
            try:
                return await provider.complete_with_tools(**kwargs)
            except (RateLimitError, ServiceUnavailableError) as e:
                logger.warning("LLM provider %s failed: %s, trying next", provider, e)
                continue
        raise AllProvidersFailedError("所有 LLM provider 均不可用")
```

**当前缺口**：当前硬编码单 OpenAI provider。Phase 4 扩展。

#### 4.7.8 客户支持与反馈闭环

商用产品需要用户反馈→产品改进的闭环：

| 反馈类型 | 收集方式 | 后续处理 |
|----------|---------|---------|
| 对话质量评价 | 每轮回复后"👍/👎"按钮 | 👎 触发质量分析流程 |
| 智能体评价 | 智能体详情页评分 | 影响市场排名 |
| Bug 报告 | 侧边栏"反馈"入口 | 创建 issue，关联会话 ID |
| 功能请求 | 反馈表单 | 累积投票，指导迭代 |

**对话质量分析流程**：

```
用户点 👎 → 弹出"问题类型"选择
  ├─ 回答不准确 → 标记 + 存入 quality_issues 表
  ├─ 工具调用错误 → 标记 + 自动捕获 tool_call 日志
  ├─ 委派错误 → 标记 + 捕获委派决策链
  └─ 其他 → 用户文本描述
       ↓
  管理后台定期分析 quality_issues → 发现模式 → 优化 prompt/工具
```

**当前缺口**：无反馈机制。Phase 4 新增 `domain/feedback/` 模块。

#### 4.7.9 国际化与本地化

面向全球市场的商用产品需要 i18n：

| 维度 | 本地化内容 | 实现方式 |
|------|-----------|---------|
| UI 文案 | 按钮、菜单、提示 | i18next（前端）+ gettext（后端） |
| 智能体 prompt | system_prompt 多语言版本 | AgentConfig 增加 `system_prompt_i18n: dict` |
| 错误信息 | 错误码 + 多语言消息 | 错误码表 + 按 `Accept-Language` 返回 |
| 日期/数字 | 时区、日期格式、货币 | 后端存 UTC，前端按 locale 格式化 |
| 智能体市场 | 智能体描述多语言 | `description_i18n: {"zh": "...", "en": "..."}` |

**智能体 prompt 本地化策略**：
- 优先使用 `system_prompt_i18n[locale]`
- 若无对应语言，fallback 到 `system_prompt`（默认英文）
- 工具描述同理：`ToolSpec.description_i18n`

**当前缺口**：前端有部分中英文混用，后端无 i18n。Phase 5 扩展。

#### 4.7.10 商用场景与架构的映射总结

| 商用场景 | 影响的架构层 | 优先级 | 实施阶段 |
|----------|-------------|--------|---------|
| 多租户隔离 | 数据模型 + Repository 查询 | P2 | Phase 4 |
| 计费配额 | 新建 billing 模块 + 入口拦截 | P2 | Phase 4 |
| 内容安全 | 新建 safety 模块 + 输入输出消毒 | P2 | Phase 4 |
| RBAC | API 层鉴权 + 权限矩阵 | P2 | Phase 4 |
| 生命周期管理 | agent_versions 表 + 状态机 | P3 | Phase 5 |
| 数据治理 | 新增导出/删除 API | P2 | Phase 4 |
| 高可用 | LLM fallback + DB 迁移 | P3 | Phase 5 |
| 反馈闭环 | 新建 feedback 模块 | P3 | Phase 5 |
| i18n | 前后端 i18n 框架 | P3 | Phase 5 |

**核心结论**：当前架构在**功能完整性**上需要 Phase 1-3 补齐。社区分享版只需 Phase 4（成本/安全/体验）+ Phase 5（生态扩展）即可满足使用。本节列出的多租户、计费、RBAC、合规等内容为**商用远期参考**，社区版暂不实现，待未来转向商用时再补齐。

### 4.8 新增 API 端点

```
# MCP 相关
GET  /api/mcp/servers                    — 列出所有 MCP server（含 tools 和 adapter_available 状态）
GET  /api/mcp/servers/{server_id}        — 获取单个 MCP server 详情
GET  /api/mcp/servers/{server_id}/tools  — 获取某 server 的所有工具

# Skill 详情
GET  /api/skills/{skill_name}            — 获取单个 skill 详情（含绑定的工具列表）
```

### 4.9 前端页面新增

#### 4.9.1 Skill Center（`/skills`）

```
┌─────────────────────────────────────────┐
│  Skill 中心                              │
├─────────────────────────────────────────┤
│  [全部] [旅行] [办公] [搜索] [开发]      │  ← 分类筛选
├─────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│  │ ✈️ 航班   │ │ 🗺️ 地图   │ │ 📝 文档   │    │  ← Skill 卡片
│  │ 查询     │ │ 导航     │ │ 编辑     │    │
│  │ [已配置]  │ │ [已配置]  │ │ [未配置]  │    │
│  └─────────┘ └─────────┘ └─────────┘    │
└─────────────────────────────────────────┘
```

#### 4.9.2 MCP Center（`/mcps`）

```
┌─────────────────────────────────────────┐
│  MCP 中心                                │
├─────────────────────────────────────────┤
│  ┌─────────────────────────────────┐     │
│  │ 🔍 web-search                    │     │  ← MCP Server 卡片
│  │ 网页搜索和新闻检索                 │     │
│  │ 工具：web_search, news_search     │     │
│  │ 状态：✅ 可用                     │     │
│  └─────────────────────────────────┘     │
│  ┌─────────────────────────────────┐     │
│  │ 🌐 chrome-devtools               │     │
│  │ 浏览器自动化                      │     │
│  │ 工具：screenshot, click, ...      │     │
│  │ 状态：⚠️ 未安装 adapter           │     │
│  └─────────────────────────────────┘     │
└─────────────────────────────────────────┘
```

#### 4.9.3 AgentEditor 改造

在现有表单中增加 MCP 多选器：

```
┌─────────────────────────────────────────┐
│  创建智能体                              │
├─────────────────────────────────────────┤
│  名称：[______________]                  │
│  图标：[🤖]                              │
│  描述：[______________]                  │
│  系统提示词：[____________________]      │
│                                         │
│  ── Skill 选择 ──                        │
│  ☑ ✈️ 航班查询 (已配置)                  │
│  ☐ 🗺️ 地图导航 (已配置)                  │
│  ☐ 📝 张雪峰风格 (已配置)                │
│                                         │
│  ── MCP 选择 ──           ← 新增         │
│  ☑ 🔍 web-search (可用)                  │
│  ☐ 🌐 chrome-devtools (未安装)           │
│                                         │
│  温度：[───●───] 0.7                    │
│  [创建]                                  │
└─────────────────────────────────────────┘
```

#### 4.9.4 NavSidebar 调整

```
┌──────────┐
│  Claw    │
│          │
│ 🤖 Agent │
│    中心  │
│          │
│ 🔧 Skill │  ← 新增
│    中心  │
│          │
│ 🔌 MCP   │  ← 新增
│    中心  │
│          │
│ 🧠 记忆  │
│          │
│ ─────── │
│ 用户名   │
│ 退出     │
└──────────┘
```

---

## 五、实施路线图

> **P2-20：实施状态总览**（2026-07-04 更新，对照 FIX_DEV_GUIDE.md P0/P1 修复结果）
>
> | Phase | 状态 | 说明 |
> |-------|------|------|
> | Phase 1 | [已实施] | DynamicAgent 已为 ReAct Agent；AgentConfig/SkillInfo 含 mcp_servers/tools；ToolSpec 分级字段齐备；ReasoningEngine 支持 disclosed 子集构建 |
> | Phase 2 | [已实施] | MCP/Skill API 与前端中心页面齐备；ToolSelector 已接线（P1-2）；Session 持久化 disclosed_tools |
> | Phase 3 | [已实施] | yunhe.yaml + OrchestratorAgent function calling + DelegationContext 状态机 + 多轮委派循环 |
> | Phase 4 | [部分实施] | CostGuard(P1-2)/ToolPolicy/PromptGuard(P0-3)/错误处理/前端事件协议(P1-11/13/14)/反馈 quality_issues/FallbackLLM(P1-15) 均已落地；草稿/发布状态字段待补 |
> | Phase 5 | [待实施] | MCP adapter 扩展/社区市场/全局限流/i18n 等远期生态项未开始 |

### Phase 1：DynamicAgent 核心能力补齐 + 渐进式披露基础（P0）

**目标**：让自定义智能体真正能使用工具和多轮对话，建立渐进式披露基础

| 任务 | 文件 | 说明 |
|------|------|------|
| AgentConfig 增加 mcp_servers 字段 | `domain/agent/schema.py` | dataclass 加字段 |
| DB schema 迁移 | `domain/agent/repository.py` | 加 mcp_servers 列 |
| SkillInfo 增加 tools 字段 | `domain/agent/schema.py` | dataclass 加字段 |
| SKILL.md/openai.yaml 解析 tools | `infrastructure/skills/provider.py` | 解析 tools 和 category |
| ToolSpec 扩展分级字段 | `infrastructure/tools/base.py` | 加 short_description/tier/confirm_required 等 |
| DynamicAgent 注入依赖 | `domain/agent/dynamic_agent.py` | 重构为 ReAct Agent |
| AgentFactory 注入新依赖 | `domain/agent/factory.py` | 传递 ToolExecutor 等 |
| app.py 组装时传递新依赖 | `app.py` | build_orchestrator 中传递 |
| ReasoningEngine 改造 | `domain/reasoning/engine.py` | `_build_tools_schema` 支持按 disclosed 子集构建 |

### Phase 2：MCP 端点 + 前端中心 + 渐进式披露完善（P1）

**目标**：用户能浏览 MCP/Skill 并在创建智能体时选择，完善渐进式披露机制

| 任务 | 文件 | 说明 |
|------|------|------|
| MCP API 端点 | `api/server.py` | GET /api/mcp/servers 等 |
| Skill 详情 API | `api/server.py` | GET /api/skills/{name} |
| 前端 MCP API 函数 | `frontend/src/utils/api.ts` | fetchMCPServers 等 |
| MCP Center 页面 | `frontend/src/pages/MCPCenter.tsx` | 新建 |
| Skill Center 页面 | `frontend/src/pages/SkillCenter.tsx` | 新建 |
| AgentEditor 加 MCP 选择器 | `frontend/src/pages/AgentEditor.tsx` | 修改 |
| NavSidebar 加入口 | `frontend/src/components/NavSidebar.tsx` | 修改 |
| App.tsx 加路由 | `frontend/src/App.tsx` | /skills, /mcps |
| 渐进披露 function calls | `domain/reasoning/engine.py` | load_skill_detail/load_mcp_info/load_tool_detail |
| ToolSelector 自动推荐 | `domain/reasoning/tool_selector.py` | 新建，基于关键词打分 |
| Session 记录 disclosed_tools | `domain/user/session/manager.py` | 持久化已披露工具集 |

### Phase 3：云合智能体 + 委派上下文（P2）

**目标**：默认智能体通过 function calling 委派，支持多智能体协作和子智能体追问

| 任务 | 文件 | 说明 |
|------|------|------|
| 云合 YAML 配置 | `application/builtin_agents/yunhe.yaml` | 新建 |
| OrchestratorAgent 重构 | `domain/agent/orchestrator.py` | 从 prompt 路由改为 function calling |
| meta-tools 实现 | `domain/agent/orchestrator.py` | delegate_to, list_agents, recall_delegation |
| 委派上下文 | `domain/agent/orchestrator.py` | DelegationContext + 状态机 |
| 交接协议 | `domain/agent/base.py` | chat() 返回 status 字段 |
| 委派上下文持久化 | `domain/user/session/manager.py` | DB 存储 delegation 状态 |
| 共享 function calls | `domain/reasoning/engine.py` | recall_memory, get_current_time 等 |
| 多轮委派循环 | `domain/agent/orchestrator.py` | ReAct 循环 + 委派 |

### Phase 4：功能完善与体验优化（P2）— 社区版

**目标**：从"能用"到"好用" — 成本可控、安全有底线、体验流畅、有反馈闭环

> 本阶段只做对社区分享有价值的内容；纯商用 SaaS 基础设施（多租户/计费/RBAC/GDPR）不做，见 4.7 节远期参考。

| 任务 | 文件 | 说明 |
|------|------|------|
| CostGuard 成本守卫 | `domain/reasoning/engine.py` | Token 预算 + 工具调用上限（防刷爆 API 费用） |
| ToolPolicy 安全策略 | `infrastructure/tools/policy.py` | confirm_required 联动 + 简单频率限制（高风险工具弹确认） |
| PromptGuard 输入消毒 | `domain/safety/prompt_guard.py`（新建） | Prompt 注入基础防御 |
| 错误处理标准化 | `domain/reasoning/engine.py` | _execute_tool_safely + 统一错误返回（不吐 traceback） |
| 前端事件协议 | `frontend/src/components/ChatWindow.tsx` | route/tool_start/need_confirmation/need_input/error 事件处理 |
| 对话反馈机制 | `domain/feedback/`（新建） | 👍/👎 + quality_issues 表 |
| LLM Provider 降级链 | `infrastructure/llm/fallback.py`（新建） | 多 provider fallback（提升可用性） |
| 智能体草稿/发布状态 | `custom_agents` 表加 status 字段 | draft/published，AgentCenter 只展示 published |

### Phase 5：生态扩展（P3，可选）— 社区版

**目标**：功能更丰富、覆盖更多场景

| 任务 | 文件/说明 | 来源 |
|------|-----------|------|
| MCP adapter 扩展 | chrome-devtools / tencent-docs / wecom-doc | MCP 生态，社区产品功能丰富度的核心 |
| 社区智能体市场 | 发布/克隆流程（无需审核） | 4.7.5 简化版 |
| 轻量全局限流 | 按 user_id + IP 简单限流（SQLite 计数器） | 4.7.7 简化版 |
| 前端 i18n | i18next 框架接入（面向全球社区可选） | 4.7.9 |
| 智能体 prompt 本地化 | AgentConfig.system_prompt_i18n | 4.7.9 |

---

## 六、架构全景图

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (React)                          │
│  ┌──────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │Nav   │ │Agent     │ │Skill     │ │MCP       │           │
│  │Sidebar│ │Center   │ │Center    │ │Center    │           │
│  └──┬───┘ └────┬─────┘ └────┬─────┘ └────┬─────┘           │
│     │          │            │            │                   │
│     └──────────┴────────────┴────────────┘                   │
│                        │ API                                 │
└────────────────────────┼────────────────────────────────────┘
                         │
┌────────────────────────┼────────────────────────────────────┐
│                    API 层 (FastAPI)                           │
│  /api/agents  /api/skills  /api/mcp/servers  /api/chat        │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────┼────────────────────────────────────┐
│                   应用层 (Application)                        │
│  AgentFactory  BuiltinAgentLoader  TrendingManager            │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────┼────────────────────────────────────┐
│                   领域层 (Domain)                              │
│                                                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │
│  │ 云合        │  │ TravelAgent │  │DynamicAgent │           │
│  │ (Orchestr.) │  │ (旅行)      │  │ (自定义)    │           │
│  │             │  │             │  │             │           │
│  │ meta-tools: │  │ skills:     │  │ skills:     │           │
│  │ list_agents │  │ [amap,      │  │ [用户选择]  │           │
│  │ delegate_to │  │  fliggy]    │  │ mcp:        │           │
│  │             │  │ mcp: []     │  │ [用户选择]  │           │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘           │
│         │                │                │                   │
│         └────────────────┴────────────────┘                   │
│                          │ BaseAgent                          │
└──────────────────────────┼───────────────────────────────────┘
                           │
┌──────────────────────────┼───────────────────────────────────┐
│                   基础设施层 (Infrastructure)                   │
│                                                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │ToolRegist│  │ToolExecut│  │MCPCatalog│  │MCPRuntime│     │
│  │ ry       │  │ or       │  │          │  │          │     │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘     │
│       │             │             │             │             │
│  ┌────┴─────────────┴────┐  ┌─────┴─────────────┴────┐      │
│  │ SkillProvider         │  │ MCP Servers             │      │
│  │ (FileSkillProvider)   │  │ (web-search, ...)       │      │
│  └───────────────────────┘  └─────────────────────────┘      │
└───────────────────────────────────────────────────────────────┘
```

---

## 七、关键设计决策

### 7.1 为什么云合用 function calling 而非 prompt 路由？

| 维度 | Prompt 路由（当前） | Function Calling（建议） |
|------|---------------------|-------------------------|
| 多智能体协作 | ❌ 只能选一个 | ✅ 可多次 delegate_to |
| 意图澄清 | ❌ 直接选 | ✅ 云合可先追问再委派 |
| 通用对话 | ❌ 总要委派 | ✅ 不调 tool 时直接回复 |
| 意图分类 | 需单独分类步骤 | ❌ 不需要，调不调 tool 就是分类 |
| 简单问题处理 | 浪费（路由给子智能体） | ✅ Tier 0 快路径 + LLM 直答 |
| 可观测性 | ❌ 黑盒 | ✅ tool_call 有结构化日志 |
| 成本 | 低（一次 LLM） | 较高（但 Tier 0 快路径可省） |

**核心洞察**：function calling 本身就是意图分类。LLM 决定调不调 `delegate_to`，就是在做"简单 vs 复杂"的分类。不需要像旅游 Agent 那样单独跑一个 `IntentClassifier`，因为云合的"工具"就是 `delegate_to`，分类和执行是一体的。

这与旅游 Agent 的设计不同：旅游 Agent 有十几个工具，需要先分类（trip_planning vs flight_search）才知道调哪个工具，所以需要单独的 `TravelIntentClassifier`。而云合只有一个"工具"（delegate_to），分类即决策。

### 7.2 为什么用"委派上下文"而非"委派前参数检查"解决子智能体追问问题？

| 维度 | 委派前参数检查 | 委派上下文（采用） |
|------|--------------|-------------------|
| 谁负责检查参数 | 云合（调度层） | 子智能体（领域层） |
| 领域知识 | ❌ 泄漏到调度层 | ✅ 留在领域层 |
| 代码复用 | ❌ 重复实现 | ✅ 复用已有 `check_missing_info_with_context` |
| 用户体验 | ⚠️ 先在云合处问答，再转智能体 | ✅ 直接和智能体对话 |
| 新增智能体 | ❌ 云合要加参数检查 | ✅ 即插即用 |

**核心原则**：云合不应该知道旅行智能体需要什么参数。参数需求是领域知识，属于子智能体。云合的职责是路由和转发，不是验证领域参数。

**委派上下文的工作方式**：一旦委派，会话进入 `DELEGATED` 状态，用户消息直接转发给当前智能体，跳过意图分类。智能体通过返回 `status` 字段（`final_answer` / `need_input` / `cannot_handle`）控制何时释放委派。

### 7.3 为什么 Skill 要声明绑定的工具？

当前 skill 只是"说明文档"，DynamicAgent 读 skill 描述注入 prompt，但不加载工具。这导致 LLM"以为"自己有工具可用，实际调用时却报错。

通过在 `openai.yaml` 中声明 `tools: [tool_name1, tool_name2]`：
- DynamicAgent 创建时，根据 `config.skills` → 查找每个 skill 的 `tools` → 从 ToolRegistry 筛选注册
- LLM 的 tool 定义只包含真正可执行的工具，避免"幻觉调用"
- Skill Center 可以展示"该技能包含哪些工具"

### 7.4 为什么 MCP 需要 `adapter_available` 状态？

MCP 分为两层：
- **Catalog 层**：扫描 `servers/` 目录的 JSON 元数据（有哪些 server、有哪些 tool）
- **Runtime 层**：实际执行工具的 adapter 代码（`MCPProxyRuntime.adapters`）

当前只有 `web-search` 有 runtime adapter。如果用户选了一个没有 adapter 的 MCP（如 `chrome-devtools`），工具调用时会报 "no runtime adapter configured" 错误。

因此 MCP Center 必须展示 `adapter_available` 状态，让用户知道哪些 MCP 真正可用。

### 7.5 DynamicAgent 的 ReAct 循环参考

当前旅游 Agent（`domain/travel/core.py`）已有完整的 ReAct 主循环：
- `Agent._run_loop()`：LLM 推理 → tool_call → 执行 → 观察 → 继续推理
- 支持 `max_iterations` 限制（防死循环）
- 支持审计日志
- 支持流式输出

DynamicAgent 的重构应**复用这套循环逻辑**，而非重新实现。可以考虑：
- 将 `_run_loop` 抽取为 `domain/reasoning/engine.py` 中的通用 `ReActEngine`
- 旅游 Agent 和 DynamicAgent 都使用 `ReActEngine`，只是注入的工具/prompt 不同

---

## 八、风险与注意事项

### 8.1 性能风险

- 云合用 function calling 委派，可能产生多次 LLM 调用（云合推理 + 子智能体推理），延迟和 token 成本翻倍
- **建议**：对简单问题（如"你好"）跳过委派，直接通用对话；只在需要专业能力时才委派

### 8.2 安全风险

- 自定义智能体执行用户选择的 MCP 工具，可能涉及敏感操作（如 `chrome-devtools` 的点击/表单填写）
- **建议**：`ToolPolicy` 对自定义智能体执行更严格的策略（CONFIRM 级别）

### 8.3 兼容性风险

- `AgentConfig` 增加 `mcp_servers` 字段后，已有的自定义智能体数据（DB 中）没有这个字段
- **建议**：DB 迁移时 `DEFAULT '[]'`，Repository 读取时做 `or []` 兜底

### 8.4 循环委派风险

- 云合 A 委派给智能体 B，B 的回复触发云合再次委派给 B，形成死循环
- **建议**：在 OrchestratorAgent 中设置 `max_delegations` 限制（如单次对话最多委派 3 次）

---

## 九、总结

用户的通用智能体愿景方向正确，当前架构的 DDD 分层、工厂模式、配置驱动设计为实施提供了良好基础。

**两条主线并行推进**：
1. **功能完整性主线**（Phase 1-3）：补齐 DynamicAgent 工具执行、MCP 全链路、云合智能委派
2. **商用就绪度主线**（Phase 4-5）：从"能用"到"敢商用" — 计费/合规/安全/高可用/国际化

建议按 Phase 1 → 2 → 3 → 4 → 5 的顺序推进，每个 Phase 都是独立可交付的价值单元：

| Phase | 交付价值 | 商用意义 |
|-------|----------|---------|
| 1 | 自定义智能体可真正使用工具 | 产品核心功能可用 |
| 2 | 用户可浏览/选择 Skill 和 MCP | 产品功能完整 |
| 3 | 云合可智能委派多智能体 | 差异化竞争力 |
| 4 | 成本控制/安全策略/错误降级/体验优化/反馈闭环 | **社区版好用** |
| 5 | MCP 生态扩展/智能体市场/i18n | 生态丰富度 |

**关键认知**：function call 设计（4.5 节）是智能体的"大脑神经"。社区分享版需要补齐"免疫系统"（安全策略/错误降级）和"皮肤"（UX 体验），让产品好用、稳定；4.7 节梳理的多租户、计费、RBAC、合规等是**商用远期参考**，社区版暂不实现，待未来转向商用时再补齐。

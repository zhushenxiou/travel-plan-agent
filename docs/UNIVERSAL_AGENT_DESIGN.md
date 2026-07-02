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

**建议**：云合的 function call 用 LLM 的原生 tool_calling 实现，而非 prompt 注入。这样 LLM 可以自主决定何时委派、委派给谁，而非靠关键词匹配。

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
5. **ReAct 循环**：参考 `domain/agent/travel_core.py` 中旅游 Agent 的主循环实现

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
        # ReAct 循环：参考 travel_core.py 的 Agent._run_loop
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

云合是特殊的内置智能体，它的"工具"不是 skill/MCP，而是**系统能力**：

```yaml
# application/builtin_agents/yunhe.yaml
id: yunhe
name: 云合
description: >
  通用智能体调度者。不直接处理专业任务，
  而是根据用户需求委派给最合适的专业智能体。
  当没有匹配的专业智能体时，进行通用对话。
icon: "🌐"
system_prompt: |
  你是"云合"，一个通用智能体调度者。
  你的职责是理解用户需求，然后委派给最合适的专业智能体。
  如果没有合适的专业智能体，你可以直接与用户对话。
  委派时使用 delegate_to 函数，传入智能体 ID 和用户消息。
skills: []           # 云合不绑定 skill
mcp_servers: []      # 云合不绑定 MCP
welcome_message: "你好！我是云合，你的通用智能体助手。有什么可以帮你的？"
temperature: 0.3     # 低温度，路由判断要确定性
```

**云合的 meta-tools（系统能力，非 skill）**：

```python
# 这些 tool 在 OrchestratorAgent 中实现，不经过 ToolRegistry
YUNHE_META_TOOLS = [
    {
        "name": "list_agents",
        "description": "列出所有可用的智能体及其能力描述",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "delegate_to",
        "description": "将用户消息委派给指定智能体处理",
        "parameters": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "string", "description": "目标智能体 ID"},
                "message": {"type": "string", "description": "要委派的消息"},
            },
            "required": ["agent_id", "message"],
        },
    },
]
```

**OrchestratorAgent 改造**：

```python
class OrchestratorAgent(BaseAgent):
    """云合 — 通用调度者。

    不再靠 prompt 路由，而是通过 LLM function calling 委派。
    云合自身可以多轮对话、多次委派。
    """

    async def chat_stream(self, *, session_id, message, user_id=None, **kwargs):
        # 1. 构建 system_prompt（含所有智能体描述 + meta-tools 定义）
        # 2. LLM 推理（带 tool_calling）
        # 3. 如果 LLM 调用了 delegate_to → 获取目标智能体 → 执行 → 结果回传 LLM
        # 4. 如果 LLM 调用了 list_agents → 返回智能体列表 → 结果回传 LLM
        # 5. 如果 LLM 没有调用 tool → 直接返回回复（通用对话）
        # 6. 循环直到 LLM 不再调用 tool
        ...
```

### 4.5 新增 API 端点

```
# MCP 相关
GET  /api/mcp/servers                    — 列出所有 MCP server（含 tools 和 adapter_available 状态）
GET  /api/mcp/servers/{server_id}        — 获取单个 MCP server 详情
GET  /api/mcp/servers/{server_id}/tools  — 获取某 server 的所有工具

# Skill 详情
GET  /api/skills/{skill_name}            — 获取单个 skill 详情（含绑定的工具列表）
```

### 4.6 前端页面新增

#### 4.6.1 Skill Center（`/skills`）

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

#### 4.6.2 MCP Center（`/mcps`）

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

#### 4.6.3 AgentEditor 改造

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

#### 4.6.4 NavSidebar 调整

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

### Phase 1：DynamicAgent 核心能力补齐（P0）

**目标**：让自定义智能体真正能使用工具和多轮对话

| 任务 | 文件 | 说明 |
|------|------|------|
| AgentConfig 增加 mcp_servers 字段 | `domain/agent/schema.py` | dataclass 加字段 |
| DB schema 迁移 | `domain/agent/repository.py` | 加 mcp_servers 列 |
| SkillInfo 增加 tools 字段 | `domain/agent/schema.py` | dataclass 加字段 |
| SKILL.md/openai.yaml 解析 tools | `infrastructure/skills/provider.py` | 解析 tools 和 category |
| DynamicAgent 注入依赖 | `domain/agent/dynamic_agent.py` | 重构为 ReAct Agent |
| AgentFactory 注入新依赖 | `domain/agent/factory.py` | 传递 ToolExecutor 等 |
| app.py 组装时传递新依赖 | `app.py` | build_orchestrator 中传递 |

### Phase 2：MCP 端点 + 前端中心（P1）

**目标**：用户能浏览 MCP/Skill 并在创建智能体时选择

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

### Phase 3：云合智能体（P2）

**目标**：默认智能体通过 function calling 委派，支持多智能体协作

| 任务 | 文件 | 说明 |
|------|------|------|
| 云合 YAML 配置 | `application/builtin_agents/yunhe.yaml` | 新建 |
| OrchestratorAgent 重构 | `domain/agent/orchestrator.py` | 从 prompt 路由改为 function calling |
| meta-tools 实现 | `domain/agent/orchestrator.py` | list_agents, delegate_to |
| 多轮委派循环 | `domain/agent/orchestrator.py` | ReAct 循环 + 委派 |

### Phase 4：MCP 生态扩展（P2）

**目标**：增加更多可用的 MCP server

| 任务 | 说明 |
|------|------|
| chrome-devtools MCP | 浏览器自动化（截图、点击、表单填写） |
| tencent-docs MCP | 腾讯文档读写 |
| wecom-doc MCP | 企业微信文档 |
| MCP adapter 实现 | 为每个新 MCP server 实现 runtime adapter |

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
| 可观测性 | ❌ 黑盒 | ✅ tool_call 有结构化日志 |
| 成本 | 低（一次 LLM） | 较高（可能多次 LLM） |

### 7.2 为什么 Skill 要声明绑定的工具？

当前 skill 只是"说明文档"，DynamicAgent 读 skill 描述注入 prompt，但不加载工具。这导致 LLM"以为"自己有工具可用，实际调用时却报错。

通过在 `openai.yaml` 中声明 `tools: [tool_name1, tool_name2]`：
- DynamicAgent 创建时，根据 `config.skills` → 查找每个 skill 的 `tools` → 从 ToolRegistry 筛选注册
- LLM 的 tool 定义只包含真正可执行的工具，避免"幻觉调用"
- Skill Center 可以展示"该技能包含哪些工具"

### 7.3 为什么 MCP 需要 `adapter_available` 状态？

MCP 分为两层：
- **Catalog 层**：扫描 `servers/` 目录的 JSON 元数据（有哪些 server、有哪些 tool）
- **Runtime 层**：实际执行工具的 adapter 代码（`MCPProxyRuntime.adapters`）

当前只有 `web-search` 有 runtime adapter。如果用户选了一个没有 adapter 的 MCP（如 `chrome-devtools`），工具调用时会报 "no runtime adapter configured" 错误。

因此 MCP Center 必须展示 `adapter_available` 状态，让用户知道哪些 MCP 真正可用。

### 7.4 DynamicAgent 的 ReAct 循环参考

当前旅游 Agent（`domain/agent/travel_core.py`）已有完整的 ReAct 主循环：
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

用户的通用智能体愿景方向正确，当前架构的 DDD 分层、工厂模式、配置驱动设计为实施提供了良好基础。核心瓶颈在于 **DynamicAgent 的能力补齐**（工具执行 + 会话记忆）和 **MCP 的全链路打通**（API + 前端 + DynamicAgent 接入）。

建议按 Phase 1 → 2 → 3 → 4 的顺序推进，每个 Phase 都是独立可交付的价值单元：

| Phase | 交付价值 | 预计涉及文件数 |
|-------|----------|---------------|
| 1 | 自定义智能体可真正使用工具 | ~8 个后端文件 |
| 2 | 用户可浏览/选择 Skill 和 MCP | ~6 个前端文件 + 2 个后端 |
| 3 | 云合可智能委派多智能体 | ~3 个后端文件 |
| 4 | 更多 MCP 能力可用 | MCP server 文件 + adapter |

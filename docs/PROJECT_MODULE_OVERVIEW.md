# 项目功能模块梳理与问题清单

> **文档目的**：本项目由 AI 生成，作者对各模块业务逻辑不熟悉。本文档基于全量代码梳理，给出每个模块的职责、关键流程、依赖关系，并汇总已发现的不合理之处（按严重程度分级），供后续人工开发决策参考。
> **生成日期**：2026-07-04
> **梳理范围**：domain / infrastructure / api / application / frontend 全量代码

---

## 目录

- [一、项目整体架构](#一项目整体架构)
- [二、各模块梳理](#二各模块梳理)
  - [2.1 智能体核心层（domain/agent + domain/reasoning）](#21-智能体核心层domainagent--domainreasoning)
  - [2.2 用户/记忆/反馈/安全层](#22-用户记忆反馈安全层)
  - [2.3 旅行领域 + 工具/MCP/技能系统](#23-旅行领域--工具mcp技能系统)
  - [2.4 LLM/持久化/API/应用层](#24-llm持久化api应用层)
  - [2.5 前端层（frontend/src）](#25-前端层frontendsrc)
- [三、不合理之处汇总（按严重程度）](#三不合理之处汇总按严重程度)
  - [P0 严重问题（影响功能/安全，建议立即修复）](#p0-严重问题影响功能安全建议立即修复)
  - [P1 中等问题（架构债务，建议尽快处理）](#p1-中等问题架构债务建议尽快处理)
  - [P2 低问题（细节优化，可延后）](#p2-低问题细节优化可延后)
- [四、建议的修复优先级路线](#四建议的修复优先级路线)

---

## 一、项目整体架构

### 1.1 分层结构（DDD 风格）

```
┌─────────────────────────────────────────────┐
│  前端 React (frontend/src)                    │
│  pages / components / hooks / utils           │
└──────────────────┬──────────────────────────┘
                   │ HTTP + SSE
┌──────────────────┴──────────────────────────┐
│  API 层 (api/server.py 单文件 1425 行)        │
│  50+ 路由 + 内联 auth/rate_limit 中间件       │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────┴──────────────────────────┐
│  应用层 (application/)                        │
│  BuiltinAgentLoader / TrendingManager / CLI   │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────┴──────────────────────────┐
│  领域层 (domain/)                             │
│  agent / reasoning / memory / user /         │
│  travel / safety / feedback / shared         │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────┴──────────────────────────┐
│  基础设施层 (infrastructure/)                 │
│  llm / persistence / tools / mcp / skills    │
└─────────────────────────────────────────────┘
```

### 1.2 入口与组装

- **入口文件**：[app.py](file:///c:/Users/29105/Desktop/claw7/app.py)
- **主组装函数**：`build_orchestrator()`（[app.py:149-225](file:///c:/Users/29105/Desktop/claw7/app.py#L149-L225)）

**组装流程**：
```
settings → init_db / init_from_settings
         → AuditLogger → OpenAILLM（单实例，全局共享）
         → FileSkillProvider → MCPCatalog → MCPProxyRuntime
         → _build_tool_infrastructure → ToolRegistry / ToolExecutor
         → SessionManager
         → BuiltinAgentLoader → builtin_configs (yunhe/travel/academic)
         → _build_travel_agent_core(skip_init=True) → Agent
         → AgentFactory（注入 7 个依赖 + travel_builder）
         → CustomAgentRepository
         → OrchestratorAgent（default_agent="yunhe"）
         → AppContainer → app.state.*
```

### 1.3 数据库（SQLite）

主库 `data/claw.db`，开启 WAL + foreign_keys。**无 alembic，迁移靠 `_run_migrations` 里一串 `if col not in PRAGMA table_info` 探测式补丁**（[database.py:62-178](file:///c:/Users/29105/Desktop/claw7/infrastructure/persistence/database.py#L62-L178)）。

**主要表**：
| 表名 | 用途 |
|------|------|
| `users` | 用户账号 |
| `auth_tokens` | opaque token（7 天有效期） |
| `sessions` | 会话（迁移加了 delegation/disclosed 字段，但**仍无 user_id**） |
| `session_turns` | 会话消息轮次 |
| `tasks` | 任务状态（**被复用为 session↔user 映射**，因 sessions 无 user_id） |
| `profiles` | 用户画像 |
| `memories` | 旧版记忆（被新双层体系架空） |
| `short_term_memories` | 短期记忆 |
| `long_term_memories` | 长期记忆 |
| `memory_extractions` | 记忆抽取记录 |
| `itineraries` / `itinerary_days` / `itinerary_activities` | 行程 |
| `shared_links` | 行程分享 |
| `album_photos` | 相册（含 EXIF 经纬度） |
| `custom_agents` | 自定义智能体（含 mcp_servers/status） |
| `quality_issues` | 对话质量反馈 |
| `news_favorites` | 新闻收藏 |

---

## 二、各模块梳理

### 2.1 智能体核心层（domain/agent + domain/reasoning）

#### 2.1.1 BaseAgent 接口（[base.py](file:///c:/Users/29105/Desktop/claw7/domain/agent/base.py)）

抽象基类，仅声明接口：
- `name` / `description`：抽象属性
- `chat()`：异步同步对话，返回 dict（含 `status` / `reply` / `missing_info` / `active_agent` / `agent_actions`）
- `chat_stream()`：异步流式，yield dict

**status 字段约定**：`"final_answer" | "need_input" | "cannot_handle"`。注释中明确 `TravelAgent` 返回 `"completed"` 也会被云合兼容（向后兼容设计）。

#### 2.1.2 AgentConfig / SkillInfo（[schema.py](file:///c:/Users/29105/Desktop/claw7/domain/agent/schema.py)）

- `AgentConfig`：dataclass，含 id/name/system_prompt/skills/mcp_servers/temperature/source/is_public/status/user_id 等
- `SkillInfo`：含 tools/category 等渐进式披露字段
- 与设计文档 4.1.1/4.1.2 节完全一致

#### 2.1.3 AgentFactory（[factory.py](file:///c:/Users/29105/Desktop/claw7/domain/agent/factory.py)）

创建分支：
1. `config.source == "builtin"` 且 `config.id in builtin_builders` → 调对应 builder（如 TravelAgent）
2. 否则 → 默认用 `DynamicAgent`

#### 2.1.4 OrchestratorAgent（云合，[orchestrator.py](file:///c:/Users/29105/Desktop/claw7/domain/agent/orchestrator.py)）

**当前实现状态**：**已采用 function calling 委派**（不再是纯 prompt 路由），与设计文档 4.4 节目标基本一致。

**三层决策架构**：
1. **Tier 0 规则快路径**（`_is_fast_chat`，L242）：命中 `_FAST_CHAT` 集合 → `_direct_reply` 直答（不注入 tools）
2. **Tier 1 LLM function calling**（L292）：注入 `YUNHE_META_TOOLS`（`delegate_to` + `list_available_agents`）
   - 无 tool_call → 直接回复
   - `delegate_to` → Tier 2
3. **Tier 2 委派执行**：调子智能体 `chat()`，根据返回 status 分支：
   - `need_input` → 设置委派上下文，yield done
   - `final_answer` → 结果回传云合 LLM 继续循环

**委派上下文**（`DelegationContext`，L21）：含 agent_id/status/started_at/last_interaction/delegation_count，持久化到 sessions 表。`_MAX_DELEGATIONS = 3` 防死循环。

**关键点**：
- `__getattr__`（L148）将未定义方法委托给 travel agent 的底层实现（向后兼容，但有性能风险）
- `_agent_cache` 仅以 `agent_id` 为 key，**不含 user_id**——同一 agent_id 不同用户共享实例

#### 2.1.5 DynamicAgent（[dynamic_agent.py](file:///c:/Users/29105/Desktop/claw7/domain/agent/dynamic_agent.py)）

**当前状态**：**已是完整 ReAct Agent**（设计文档 2.2 节"空壳"描述已过时）。

**核心流程**：
1. `_resolve_tools`（L90-125）：根据 `config.skills` + `config.mcp_servers` 解析工具名（从 skill.tools 和 MCP catalog.list_tool_refs()）
2. 构建专属 `ToolRegistry` + `ToolExecutor` + `ReasoningEngine`
3. `chat()` 调 `reasoning.run()`，捕获 `AskUserNeeded`/`ConfirmationNeeded` → status="need_input"
4. `_upsert_task_row`（L263）：同步更新 tasks 表（保证会话列表能查到）

**注意**：`DynamicAgent` 从不返回 `"cannot_handle"`，导致 orchestrator 的 cannot_handle 分支对它无效。

#### 2.1.6 TravelAgent（[domain/travel/agent.py](file:///c:/Users/29105/Desktop/claw7/domain/travel/agent.py)）

**包装器/装饰器**，包装 `domain.travel.core.Agent`：
- `__getattr__` 委托未定义方法
- `_extract_actions`（L46）：从回复中提取 itinerary_id 生成跳转建议（优先结构化字段，兜底正则）
- `chat/chat_stream` 委托底层

**注意**：`domain/agent/travel_core.py` 是**空文件**，但设计文档多处声称它含主循环。真实实现是 `domain/travel/core.py`。

#### 2.1.7 ReasoningEngine（[engine.py](file:///c:/Users/29105/Desktop/claw7/domain/reasoning/engine.py)）

**ReAct 循环核心**（`run` L321-605）：
1. 迭代 `range(1, max_iterations + 1)`（默认 15）
2. native 模式：`complete_with_tools`（临近上限时 `tools=None` 强制直答）
3. 转 `Decision`（含从 content 文本解析 tool_calls 的兜底，兼容通义千问）
4. **FINAL_ANSWER 分支**：
   - `force_tool` 且未执行工具 → 强制重试
   - 已执行但 `_looks_grounded` 为 False → ungrounded_rounds++，3 次后接受 best_text
5. **TOOL_CALLS 分支**：
   - 重复签名检测（同签名 ≥3 次强制改道）
   - 临近上限 → 强制最终答案
   - `tool_executor.execute()` → 处理 `ConfirmationNeeded`/`AskUserNeeded`
6. 超过 max_iterations → 返回 best_text

**run_stream（L624-817）**：工具阶段非流式，最终答案阶段流式（已执行工具时按 chunk_size=3 模拟流式）。

**渐进式披露是否实现**：**未实现**。`_build_tools_schema(disclosed_tools)` 预留了子集构建参数，但 `run()` / `run_stream()` 均无参调用（全量）。引擎中**没有** `load_skill_detail` / `load_tool_detail` 等 meta-tool 处理逻辑。

#### 2.1.8 其他 reasoning 文件

| 文件 | 职责 | 是否接入 |
|------|------|---------|
| [context_manager.py](file:///c:/Users/29105/Desktop/claw7/domain/reasoning/context_manager.py) | 裁剪会话上下文 | 仅 travel/core 用，DynamicAgent 不用 |
| [cost_guard.py](file:///c:/Users/29105/Desktop/claw7/domain/reasoning/cost_guard.py) | 成本预算检查 | **未接入**（ReasoningEngine 直接用 settings.max_iterations） |
| [prompt_context.py](file:///c:/Users/29105/Desktop/claw7/domain/reasoning/prompt_context.py) | prompt 上下文容器 | 仅 travel/core 用 |
| [prompting.py](file:///c:/Users/29105/Desktop/claw7/domain/reasoning/prompting.py) | 旅行 prompt 构建器 | 仅 travel/core 用（职责越界，应迁到 domain/travel/） |
| [tool_selector.py](file:///c:/Users/29105/Desktop/claw7/domain/reasoning/tool_selector.py) | 工具自动推荐 | **未接入** |

---

### 2.2 用户/记忆/反馈/安全层

#### 2.2.1 用户认证（[domain/user/auth/](file:///c:/Users/29105/Desktop/claw7/domain/user/auth)）

- `UserStore`（[auth.py](file:///c:/Users/29105/Desktop/claw7/domain/user/auth/auth.py)）：PBKDF2-HMAC-SHA256 哈希（100000 轮），**内存缓存首次加载后永不刷新**
- `verify_token`（[token.py](file:///c:/Users/29105/Desktop/claw7/domain/user/auth/token.py)）：**opaque token（sha256），不是 JWT**，无 RBAC。7 天有效期。每次校验先全表 DELETE 过期 token
- 鉴权中间件（[api/middleware/auth.py](file:///c:/Users/29105/Desktop/claw7/api/middleware/auth.py)）：**整个文件是死代码**，server.py 用内联 `auth_middleware` 函数，且**支持从 query 参数 `?token=` 取 token**（有泄露风险）

#### 2.2.2 Session 管理（[session/manager.py](file:///c:/Users/29105/Desktop/claw7/domain/user/session/manager.py)）

- `SessionManager`：内存 dict 优先 → redis（可选）→ DB → 新建空 Session
- `save`：**全量重写 turns**（DELETE 再 INSERT 全部），长会话每次 O(n) 重写
- 委派上下文持久化到 sessions 表（已实现）
- 渐进式披露工具集持久化（已实现，但没人写入）
- `_load` 用 try/except + `"col" in row.keys()` 兼容旧库（说明迁移机制缺失）

#### 2.2.3 TaskStateStore（[session/task_state.py](file:///c:/Users/29105/Desktop/claw7/domain/user/session/task_state.py)）

**tasks 表的真实角色**：
- 表面是任务状态机（goal/pending_prompt/trace_summary/tool_result_cache）
- 实际被复用为 **session↔user 映射表**（因 sessions 表无 user_id 列）：
  - `list_user_sessions`（server.py L905）用 `SELECT DISTINCT session_id FROM tasks WHERE user_id=?` 查会话列表
  - `travel_tools.py` L37 用它反查 user_id
  - DynamicAgent 被迫 `_upsert_task_row` 维护这行

**问题**：`_upsert_task_row` 无条件把 status 写成 `'completed'`，**破坏了 TaskStateStore 维护的真实状态机**。

#### 2.2.4 记忆系统（[domain/memory/](file:///c:/Users/29105/Desktop/claw7/domain/memory)）

**DualLayerMemoryManager**：操作 `short_term_memories`/`long_term_memories`（user_id 维度）。

**实际接入情况**：
- 生产主流程（travel/core.py）只用 `build_full_context`（读）
- **MemoryExtractor（LLM 提取）和 MemoryDistiller（蒸馏）完全未接入主流程**，只在 tests 调用
- 记忆检索是 **Python 端全表扫描打分**（无 SQL FTS、无向量检索）

> **注**：旧版 `MemoryManager`（操作 `memories` 表）和 `MemoryRecord` 已于 2026-07-04 删除，`DualLayerMemoryManager` 不再透传旧版接口。`memories` 表也已从 schema 移除。

#### 2.2.5 情绪检测（[emotion/](file:///c:/Users/29105/Desktop/claw7/domain/user/emotion)）

- `EmotionDetector.detect`：先关键词匹配（置信度 ≥0.7 直接返回），否则走 LLM
- 检测后调 `metrics.record_emotion` 上报指标
- 输出 `EmotionType` + `response_style` + `system_prompt_suffix`

#### 2.2.6 用户画像（[profile/](file:///c:/Users/29105/Desktop/claw7/domain/user/profile)）

- `ProfileManager`：内存缓存 + 懒加载，**永不失效**
- `update` 累加 interaction_count，追加 tags/categories/emotion_history（裁剪到 10/20 条）
- `build_context` 拼成中文文本供 LLM 注入

#### 2.2.7 反馈（[domain/feedback/](file:///c:/Users/29105/Desktop/claw7/domain/feedback)）

- **只有 repository.py**，无 service 层、无 issue_type 枚举、无聚合分析 API
- `FeedbackRepository.record/list_by_user/count_by_rating`
- `init_table` 与 database.py 重复建表，存在双重 schema 定义

#### 2.2.8 安全（[domain/safety/prompt_guard.py](file:///c:/Users/29105/Desktop/claw7/domain/safety/prompt_guard.py)）

- **第 1 行存在语法错误**：行首有多余字符 `ji"""Prompt 注入防御...`，根本无法被 import
- 即使修复语法错误，PromptGuard 也**完全未接入主流程**
- 设计文档要求"用户消息进入 LLM 前消毒"，实际用户消息直接进 LLM

#### 2.2.9 共享基础设施（[domain/shared/](file:///c:/Users/29105/Desktop/claw7/domain/shared)）

- `AuditLogger`（[audit/logger.py](file:///c:/Users/29105/Desktop/claw7/domain/shared/audit/logger.py)）：**真正接入了主流程**，按日轮转 JSONL 文件，含 log_tool_call/log_llm_call/log_intent_classify 等专用方法。**无自动清理，磁盘满则审计丢失**
- `MetricsCollector`（[metrics/collector.py](file:///c:/Users/29105/Desktop/claw7/domain/shared/metrics/collector.py)）：Prometheus 指标，`record_emotion` 真实调用，但 `active_sessions` Gauge 定义后从未 inc/dec（dead metric）
- `TraceStore`（[runtime/trace.py](file:///c:/Users/29105/Desktop/claw7/domain/shared/runtime/trace.py)）：**纯内存**，只存最新一条，重启全丢
- `sanitizer`（[audit/sanitizer.py](file:///c:/Users/29105/Desktop/claw7/domain/shared/audit/sanitizer.py)）：4 条正则脱敏（手机/身份证/邮箱/银行卡），**会误伤 16-19 位订单号/时间戳**

---

### 2.3 旅行领域 + 工具/MCP/技能系统

#### 2.3.1 旅行 Agent 核心（[domain/travel/core.py](file:///c:/Users/29105/Desktop/claw7/domain/travel/core.py)）

`Agent` 类是真正的旅行规划核心，承载所有业务逻辑。`chat` 流程（L91-421）：

1. 设置审计上下文
2. 运行时事实直答（日期/时间）
3. 意图识别（`TravelIntentClassifier.classify`）
4. 情绪检测
5. 紧急关键词短路
6. 快速回复路径（CHAT/QUERY）
7. **行程确认直通路径**（ITINERARY_CONFIRM → `_direct_generate_itinerary`，绕过 LLM）
8. 构建 PromptContext（工具/记忆/MCP/情绪/画像/缓存/缺失信息/行程确认）
9. ReAct 推理（`_reasoning.run`）
10. 后置记忆处理（`_post_chat_memory_processing`）

`chat_stream`（L423-681）**镜像 chat 逻辑**，近 250 行几乎相同代码（应抽取公共方法）。

#### 2.3.2 TravelIntentClassifier 三层分类（[intent/travel_classifier.py](file:///c:/Users/29105/Desktop/claw7/domain/travel/intent/travel_classifier.py)）

1. **规则快路径**：`_FAST_CHAT` 命中或长度 ≤1 → GENERAL_CHAT（confidence 0.9）
2. **关键词分类**：`_TRAVEL_PATTERNS`（16 种意图）匹配，confidence ≥0.7 直接返回（单关键词 0.75，双词 0.9）
3. **LLM 兜底**：返回 JSON

辅助：`_extract_destination`（已知城市集合 + 正则）、`_check_missing_info`/`_regex_missing_info`（按意图检查缺失字段）。

#### 2.3.3 行程模块（[itinerary/](file:///c:/Users/29105/Desktop/claw7/domain/travel/itinerary)）

- `ItineraryParser.parse`：LLM 解析行程文本为结构化对象
- `ItineraryParser.parse_simple`：正则降级方案
- `ItineraryRepository.save_full_itinerary`：级联创建 itinerary→days→activities
- `travel_tools._generate_itinerary_overview`：核心工具，从参数或会话历史提取行程内容（**启发式提取，脆弱**）

#### 2.3.4 相册模块（[album/](file:///c:/Users/29105/Desktop/claw7/domain/travel/album)）

行程的子模块，强绑定 `itinerary_id`：
- `AlbumService.upload`：校验图片、生成缩略图、提取 EXIF（GPS/拍摄时间）、按拍摄时间匹配 day_index、调多模态模型生成 AI 描述和标签
- `AlbumService.generate_travelogue`：根据行程+照片生成图文游记，插入 `【photo:ID】` 标记

#### 2.3.5 工具系统（[infrastructure/tools/](file:///c:/Users/29105/Desktop/claw7/infrastructure/tools)）

| 文件 | 职责 |
|------|------|
| [base.py](file:///c:/Users/29105/Desktop/claw7/infrastructure/tools/base.py) | `ToolSpec`（含渐进式披露字段 tier/short_description/disclosure_keywords/confirm_required/skill_binding/mcp_source）+ `ToolHandler` + `bind_tool` |
| [registry.py](file:///c:/Users/29105/Desktop/claw7/infrastructure/tools/registry.py) | 内存字典注册，`list_names` 按 hints 过滤 |
| [executor.py](file:///c:/Users/29105/Desktop/claw7/infrastructure/tools/executor.py) | 执行工具：policy.check → registry 查找 → handler 调用 → 审计 |
| [policy.py](file:///c:/Users/29105/Desktop/claw7/infrastructure/tools/policy.py) | 决策链：run_shell 高危 DENY/风险 CONFIRM、write_file /etc DENY、confirm_required 联动、内存频率限制（30/min、200/hour） |
| [catalog.py](file:///c:/Users/29105/Desktop/claw7/infrastructure/tools/catalog.py) | 仅存 spec 无 handler，**与 ToolRegistry 重叠，疑似死代码** |

**适配器**（[adapters/](file:///c:/Users/29105/Desktop/claw7/infrastructure/tools/adapters)）：
- `amap.py`：高德地图（POI/路线/天气）—— **脚本路径断裂，工具必然失败**
- `fliggy.py`：飞猪（机票/火车/酒店）—— **脚本路径断裂，工具必然失败**
- `http.py`：通用 HTTP 抓取
- `interaction.py`：向用户提问
- `shared.py`：Layer 3 共享工具（get_current_time、request_confirmation）

#### 2.3.6 MCP 系统（[infrastructure/mcp/](file:///c:/Users/29105/Desktop/claw7/infrastructure/mcp)）

- `MCPCatalog`（[catalog.py](file:///c:/Users/29105/Desktop/claw7/infrastructure/mcp/catalog.py)）：**纯元数据扫描器**，遍历 `servers/` 子目录读 `SERVER_METADATA.json` + `tools/*.json`。`proxy_name = mcp__{server}__{tool}`
- `MCPProxyRuntime`（[runtime.py](file:///c:/Users/29105/Desktop/claw7/infrastructure/mcp/runtime.py)）：**执行层**，`build_default_adapters` 只注册了 6 个 adapter

**MCP server 可用性**：
| Server | 真正可用 | 说明 |
|--------|---------|------|
| **web-search** | ✅ | web_search、news_search |
| **arxiv** | ✅ | search_papers、get_abstract 等 4 个 |
| chrome-devtools | ❌ | 仅元数据，无 adapter |
| tencent-docs | ❌ | 仅元数据，无 adapter |
| wecom-doc | ❌ | 仅元数据，无 adapter |

**问题**：`build_specs`/`build_handlers` 为所有工具生成 spec（即使无 adapter），若直接注册到 registry，无 adapter 的工具运行时才报错，浪费 LLM token。

#### 2.3.7 技能系统（[infrastructure/skills/](file:///c:/Users/29105/Desktop/claw7/infrastructure/skills)）

- `FileSkillProvider._load`：遍历 `skills_dir` 的**直接子目录**，对每个调 `_parse_skill`
- `_parse_skill`：读 `SKILL.md`（YAML frontmatter）+ `agents/openai.yaml`（interface.display_name/default_prompt/**tools**/category）
- `interface.tools` 字段**确实被解析**

**目录结构异常**：
`builtin/` 根目录下散落着 `amap-maps` skill 的文件（`builtin/SKILL.md` + `builtin/agents/openai.yaml` + `builtin/scripts/amap_tool.py`），**没放进 `builtin/amap-maps/` 子目录**。`FileSkillProvider` 只扫描子目录，因此 **amap-maps skill 永远不会被加载**。

---

### 2.4 LLM/持久化/API/应用层

#### 2.4.1 LLM 封装（[infrastructure/llm/](file:///c:/Users/29105/Desktop/claw7/infrastructure/llm)）

- `OpenAILLM`（[openai.py](file:///c:/Users/29105/Desktop/claw7/infrastructure/llm/openai.py)）：封装 OpenAI 兼容协议（实际指向阿里云 dashscope），支持 `complete`/`stream_complete`/`complete_with_tools`/`complete_json`
  - `set_audit_context` 把 session_id/user_id/trace_id 写到**实例属性**——全局单例下并发会互相覆盖审计上下文
- `FallbackLLM`（[fallback.py](file:///c:/Users/29105/Desktop/claw7/infrastructure/llm/fallback.py)）：多 provider 降级链——**定义了但完全没接入主流程**

#### 2.4.2 持久化（[infrastructure/persistence/](file:///c:/Users/29105/Desktop/claw7/infrastructure/persistence)）

- `database.py`：SQLite + WAL + foreign_keys，线程局部连接。**无版本号、无 alembic，迁移靠探测式补丁**
- `health.py`：**只检查 Redis**，不检查 SQLite——但 session_backend="file"，Redis 未必启用，health 与实际存储脱节

#### 2.4.3 API 层（[api/server.py](file:///c:/Users/29105/Desktop/claw7/api/server.py)）

**单文件 1425 行**，50+ 路由全部堆在此（`api/routes/` 是空目录）。`api/middleware/auth.py` 和 `rate_limit.py` **都是死代码**，server.py 用内联中间件。

**关键端点**（设计文档 4.8 要求的均已实现）：
- 对话：`POST /api/chat`、`POST /api/chat/stream`（SSE）
- 会话：`GET/POST/DELETE /api/sessions`
- 智能体：`GET /api/agents`、`POST/GET/PUT/DELETE /api/agents/custom/{id}`、`POST /api/agents/custom/{id}/clone`
- 技能：`GET /api/skills`、`GET /api/skills/{name}`
- MCP：`GET /api/mcp/servers`、`GET /api/mcp/servers/{id}`、`GET /api/mcp/servers/{id}/tools`
- 记忆：`GET /api/memories`、`DELETE /api/memories/{type}/{id}`
- 行程：完整 CRUD + 打卡 + 花费 + 分享 + 对比 + 照片 + 游记
- 反馈：`POST /api/feedback`
- 调试：`/debug/trace/{session_id}`、`/debug/session/{session_id}` 等

**问题**：
- 多处直接 `from infrastructure.persistence.database import get_connection` 写裸 SQL，绕过 Repository 层
- 限流 `_rate_counters` 是进程内字典，多 worker 部署下形同虚设
- 模块加载时即 `build_orchestrator()`，DB 异常会导致整个 import 失败

#### 2.4.4 应用层（[application/](file:///c:/Users/29105/Desktop/claw7/application)）

- `BuiltinAgentLoader`（[loader.py](file:///c:/Users/29105/Desktop/claw7/application/builtin_agents/loader.py)）：加载 yunhe.yaml / travel.yaml / academic.yaml
- `TrendingManager`（[trending/manager.py](file:///c:/Users/29105/Desktop/claw7/application/trending/manager.py)）：抓百度/头条/微博/知乎热搜，30 分钟 TTL。**函数名 `get_trending_travel` 误导**（实际是通用新闻热搜）

> **注**：`application/cli/` 目录已于 2026-07-04 删除（CLI 入口 `build_agent` 与 Web 入口能力割裂，且已有启动脚本）。

#### 2.4.5 配置（[config/settings.py](file:///c:/Users/29105/Desktop/claw7/config/settings.py)）

pydantic-settings，前缀 `CLAW_`。关键配置：
- LLM：`model="qwen3.5-122b-a10b"`、`base_url`（阿里云 dashscope）
- 运行：`max_iterations=15`、`max_context_turns=16`、`max_context_chars=400000`、`use_native_tool_calling=True`
- 安全：`allow_shell=True`、`allow_http=True`
- 后端：`session_backend="file"`、`rate_limit_rpm=60`
- 监控：`metrics_enabled`、`metrics_port=9090`

---

### 2.5 前端层（frontend/src）

#### 2.5.1 路由（[App.tsx](file:///c:/Users/29105/Desktop/claw7/frontend/src/App.tsx)）

12 个页面均有路由覆盖。三栏布局**仅在 Home.tsx 和 FavoritesPage.tsx 实现**，其它子页面无左栏 NavSidebar，用户在子页面间切换必须先回 Home。

#### 2.5.2 SSE 事件处理（[Home.tsx:163-202](file:///c:/Users/29105/Desktop/claw7/frontend/src/pages/Home.tsx#L163-L202)）

| 事件类型 | 处理 |
|---------|------|
| `chunk` | `appendToLastMessage` 拼接文本 |
| `done` | `finishLastMessage`；data=='escalated' 时 setEscalated |
| `error` | finish + 追加 ⚠️ |
| `status` | 注释说明已由 thinkingSteps 展示，无操作 |
| `tool_status` | `addThinkingStep` |
| `route` | `setActiveAgent` |
| `actions` | `setAgentActions` |
| `need_input` | **未实现**（api.ts 类型未声明、switch 无 case） |

#### 2.5.3 状态管理（[hooks/](file:///c:/Users/29105/Desktop/claw7/frontend/src/hooks)）

| Store | 状态 | 持久化 |
|-------|------|--------|
| `useAuthStore` | userId/username/token/isAuthenticated | localStorage 'yunhe-auth'（**token 存 localStorage**） |
| `useChatStore` | messages/isLoading/sessionId/isEscalated/thinkingSteps/sessions | 无 |
| `useSessionStore` | activeAgent/agentActions | 无 |
| `useItineraryStore` | itinerary/selectedDayIndex/detailActivity | 无 |
| `useAlbumStore` | photos/tags/cover/mapMarkers/travelogue | 无 |
| `useTheme.ts` | — | **死代码**，从未被调用 |

**问题**：`useChatStore` 既管当前会话又管会话列表，与 `useSessionStore` 独立管理 activeAgent，会话状态分散；`Home.tsx` 同时用 `activeSessionId` 本地 state 与 `sessionId` store 字段，存在双源真相。

#### 2.5.4 页面实现状态

| 页面 | 状态 |
|------|------|
| Home / Login / ItineraryOverview / AlbumPage / ComparePage / SharedItinerary | ✅ 完整实现 |
| AgentCenter / AgentEditor | ✅ 完整实现，**Skill 和 MCP 选择器均已落地** |
| SkillCenter / MCPCenter | ✅ 已实现（设计文档要求新建已落地） |
| MemoryPage / FavoritesPage | ✅ 完整实现 |

#### 2.5.5 关键组件

- `ChatWindow`：**不处理 SSE**，只消费 store 状态。`_extractItineraryId` 用三段正则提取 16 位 hex 行程 ID（**极脆弱**）
- `AgentActionCard`：**完全忽略 `action.type` 字段**，永远走 navigate 分支
- `AgentActivationBanner`：**仅配置 `travel` 一个智能体**，其它 agent 激活时返回 null
- `AgentRouteGuard`：检查 `activeAgent === agent`，不匹配则 Navigate to "/"
- `MemoryPanel.tsx` / `Empty.tsx`：**死代码**

#### 2.5.6 API 函数（[utils/api.ts](file:///c:/Users/29105/Desktop/claw7/frontend/src/utils/api.ts)）

50+ 函数覆盖全部后端端点。**未使用的函数**：`fetchSkillDetail`、`fetchMCPServer`、`listShareLinks`、`deleteShareLink`、`updateItinerary`——分享管理 UI 缺失（只能创建不能列出/撤销）。

---

## 三、不合理之处汇总（按严重程度）

### P0 严重问题（影响功能/安全，建议立即修复）

#### P0-1. amap/fliggy 适配器脚本路径断裂
- **位置**：[adapters/amap.py:13](file:///c:/Users/29105/Desktop/claw7/infrastructure/tools/adapters/amap.py#L13)、[adapters/fliggy.py:13](file:///c:/Users/29105/Desktop/claw7/infrastructure/tools/adapters/fliggy.py#L13)
- **问题**：`_SCRIPT` 路径解析后为 `infrastructure/tools/skills/...`，但 `infrastructure/tools/` 下根本没有 `skills/` 目录。实际脚本在 `infrastructure/skills/builtin/...`
- **后果**：所有 amap/fliggy 工具调用必然失败，旅行 Agent 的核心能力（POI 搜索、机票/酒店查询）全部不可用
- **修复**：修正脚本路径，或迁移 amap-maps skill 到 `builtin/amap-maps/` 子目录

#### P0-2. amap-maps skill 目录结构异常，永不加载
- **位置**：[infrastructure/skills/builtin/SKILL.md](file:///c:/Users/29105/Desktop/claw7/infrastructure/skills/builtin/SKILL.md)、[builtin/agents/openai.yaml](file:///c:/Users/29105/Desktop/claw7/infrastructure/skills/builtin/agents/openai.yaml)
- **问题**：`FileSkillProvider._load` 只扫描 `builtin/` 的直接子目录，但 amap-maps 的文件散落在 `builtin/` 根目录
- **后果**：amap-maps skill 永远不会出现在 `list_skills()` 结果中，前端 Skill Center 看不到，自定义智能体也无法勾选
- **修复**：迁移到 `builtin/amap-maps/` 下

#### P0-3. prompt_guard.py 存在语法错误，且完全未接入
- **位置**：[domain/safety/prompt_guard.py:1](file:///c:/Users/29105/Desktop/claw7/domain/safety/prompt_guard.py#L1)
- **问题**：行首有多余字符 `ji"""Prompt 注入防御...`，是 SyntaxError，文件根本无法被 import；即使修复也未被任何生产代码调用
- **后果**：设计文档宣称的"输入消毒层"完全形同虚设，用户消息直接进 LLM，存在 prompt 注入风险
- **修复**：修复语法错误，并在 `OrchestratorAgent.chat_stream` / `DynamicAgent.chat` 入口处接入 `PromptGuard.sanitize`

#### P0-4. tasks 表被滥用为 session↔user 映射，且 _upsert_task_row 破坏状态机
- **位置**：[dynamic_agent.py:263-290](file:///c:/Users/29105/Desktop/claw7/domain/agent/dynamic_agent.py#L263-L290)、[server.py:905](file:///c:/Users/29105/Desktop/claw7/api/server.py#L905)
- **问题**：`sessions` 表无 `user_id` 列，导致 `list_user_sessions` 用 `SELECT DISTINCT session_id FROM tasks WHERE user_id=?`。DynamicAgent 被迫 `_upsert_task_row` 维护这行，且**无条件把 status 写成 'completed'**，覆盖 TaskStateStore 维护的真实状态
- **后果**：会话列表查询逻辑脆弱；TaskStateStore 状态机被破坏；DDD 分层被违反（领域层直接写 SQL 操作其他聚合的表）
- **修复**：给 `sessions` 表加 `user_id` 列，`list_user_sessions` 直接查 sessions 表；移除 `_upsert_task_row`

#### P0-5. OpenAILLM 并发安全隐患
- **位置**：[openai.py:39-42](file:///c:/Users/29105/Desktop/claw7/infrastructure/llm/openai.py#L39-L42)
- **问题**：`set_audit_context` 把 session_id/user_id/trace_id 写到 `self._audit_*` 实例属性。`OpenAILLM` 是全局单例，多个并发请求会互相覆盖审计上下文
- **后果**：审计日志归属错乱，trace_id 串台，调试困难
- **修复**：改为参数透传，或用 `contextvars.ContextVar` 存审计上下文

#### P0-6. Token 可从 query 参数传递
- **位置**：[api/middleware/auth.py:54-55](file:///c:/Users/29105/Desktop/claw7/api/middleware/auth.py#L54-L55)（虽然死代码，但 server.py 内联中间件可能复用逻辑）
- **问题**：`token = request.query_params.get("token", "")` 会被 access log / 反代日志 / 浏览器历史记录捕获
- **后果**：token 泄露风险
- **修复**：移除 query 参数取 token 的逻辑，仅支持 Authorization header

---

### P1 中等问题（架构债务，建议尽快处理）

#### P1-1. travel_core.py 是空文件，但文档/代码多处引用
- **位置**：[domain/agent/travel_core.py](file:///c:/Users/29105/Desktop/claw7/domain/agent/travel_core.py)（空）、设计文档 L234/L277/L1989
- **问题**：真实实现在 `domain/travel/core.py`，路径差异导致设计文档严重误导
- **修复**：删除空文件，更新所有文档引用

#### P1-2. CostGuard / ToolSelector 写了但未接线
- **位置**：[cost_guard.py](file:///c:/Users/29105/Desktop/claw7/domain/reasoning/cost_guard.py)、[tool_selector.py](file:///c:/Users/29105/Desktop/claw7/domain/reasoning/tool_selector.py)
- **问题**：完整实现了预算检查和工具推荐，但 `ReasoningEngine.run()` 从未调用。设计文档 Phase 4 / 4.5.6 描述的"成本控制"和"双轨披露"均未实现
- **修复**：在 `ReasoningEngine.run` 循环开头调 `cost_guard.can_continue()`，循环内调 `tool_selector.select()` 自动披露工具

#### P1-3. MemoryExtractor / MemoryDistiller 完全未接入主流程
- **位置**：[memory_extractor.py](file:///c:/Users/29105/Desktop/claw7/domain/memory/memory_extractor.py)、[memory_distiller.py](file:///c:/Users/29105/Desktop/claw7/domain/memory/memory_distiller.py)
- **问题**：设计上的"LLM 提取 → 短期 → 蒸馏 → 长期"闭环根本没跑起来。生产主流程（travel/core.py）只读取 `build_full_context`，无任何写入路径（旧版关键词触发的 `maybe_learn_from_message` 已随旧版记忆系统删除）
- **修复**：在会话结束/达到一定轮次后触发 `MemoryExtractor.extract`，定时任务调 `MemoryDistiller.run_distillation`

#### P1-4. ~~两套记忆表并存且语义混乱~~ ✅ 已解决（2026-07-04）
- 旧版 `MemoryManager` / `MemoryRecord` / `memories` 表已删除，`DualLayerMemoryManager` 不再透传旧版接口。记忆体系统统一到 `short_term_memories` / `long_term_memories` 双层体系。

#### P1-5. SessionManager.save 全量重写 turns
- **位置**：[session/manager.py:93-98](file:///c:/Users/29105/Desktop/claw7/domain/user/session/manager.py#L93-L98)
- **问题**：`DELETE FROM session_turns WHERE session_id=?` 再逐条 INSERT，长会话每次 O(n) 重写，且无事务隔离，中途崩溃会丢 turns
- **修复**：改为只 INSERT 新 turn，或用事务包裹 DELETE+INSERT

#### P1-6. travel/core.py 的 chat 与 chat_stream 大量逻辑重复
- **位置**：[core.py:91-421](file:///c:/Users/29105/Desktop/claw7/domain/travel/core.py#L91-L421) vs [423-681](file:///c:/Users/29105/Desktop/claw7/domain/travel/core.py#L423-L681)
- **问题**：近 250 行上下文构建逻辑完全复制
- **修复**：抽取 `_prepare_context()` 公共方法

#### P1-7. 旅行 Agent 与通用 Agent 的 prompt/上下文体系割裂
- **位置**：[prompting.py](file:///c:/Users/29105/Desktop/claw7/domain/reasoning/prompting.py)、[context_manager.py](file:///c:/Users/29105/Desktop/claw7/domain/reasoning/context_manager.py)
- **问题**：这三个文件位于通用 `domain/reasoning/`，但只有 travel/core 使用。DynamicAgent 有自己的 `_build_system_prompt`，完全绕过这套体系。设计文档 7.5 节期望两者复用同一套循环与 prompt 体系，实际未达成
- **修复**：将 `prompting.py` 迁到 `domain/travel/`，或抽象为通用骨架 + 领域插件

#### P1-8. 中间件层是死代码
- **位置**：[api/middleware/auth.py](file:///c:/Users/29105/Desktop/claw7/api/middleware/auth.py)、[api/middleware/rate_limit.py](file:///c:/Users/29105/Desktop/claw7/api/middleware/rate_limit.py)
- **问题**：`AuthMiddleware` 类与 server.py 内联 `auth_middleware` 逻辑重复且从未注册；`RateLimitMiddleware` 自述"未启用"；`PUBLIC_PATHS` 在两处重复定义
- **修复**：删除 middleware/ 目录，或反过来把内联逻辑迁回 middleware 类并注册

#### P1-9. 限流实现脆弱
- **位置**：[server.py:78-116](file:///c:/Users/29105/Desktop/claw7/api/server.py#L78-L116)
- **问题**：`_rate_counters` 是进程内字典，多 worker 部署下各自计数，限流形同虚设；重启即丢；硬编码 60 而非读 settings.rate_limit_rpm
- **修复**：用 Redis 计数器，或至少在 settings 里配置

#### P1-10. API 层直接操作 DB，绕过 Repository
- **位置**：[server.py:546/628/743/764/797/812/902](file:///c:/Users/29105/Desktop/claw7/api/server.py#L546)
- **问题**：多处直接 `from infrastructure.persistence.database import get_connection` 写裸 SQL，而 ItineraryRepository/CustomAgentRepository/FeedbackRepository 抽象不一致——有的走 Repository，有的直连
- **修复**：统一所有数据访问走 Repository 层

#### P1-11. need_input SSE 事件前端未实现
- **位置**：[api.ts:64](file:///c:/Users/29105/Desktop/claw7/frontend/src/utils/api.ts#L64)、[Home.tsx:166-201](file:///c:/Users/29105/Desktop/claw7/frontend/src/pages/Home.tsx#L166-L201)
- **问题**：`StreamEvent.type` 联合类型未声明 `need_input`，switch 也无对应 case。后端发送该事件会被静默丢弃
- **后果**：DynamicAgent 返回 `need_input` 时，前端无法呈现"请补充信息"的追问气泡，用户体验断裂
- **修复**：在 api.ts 加 `need_input` 类型，在 Home.tsx 加 case 处理

#### P1-12. 三栏布局不一致
- **位置**：AgentCenter / AgentEditor / SkillCenter / MCPCenter / MemoryPage / ItineraryOverview / ComparePage
- **问题**：仅 Home 和 FavoritesPage 有左栏 NavSidebar，其它子页面无左栏，用户在子页面间切换必须先回 Home
- **修复**：在所有鉴权页面统一渲染 NavSidebar（可折叠）

#### P1-13. 行程 ID 靠正则从文本提取，极脆弱
- **位置**：[ChatWindow.tsx:48-56](file:///c:/Users/29105/Desktop/claw7/frontend/src/components/ChatWindow.tsx#L48-L56)、[domain/travel/agent.py:58-65](file:///c:/Users/29105/Desktop/claw7/domain/travel/agent.py#L58-L65)
- **问题**：用三段正则匹配 16 位 hex 行程 ID，任何回复中出现 16 位十六进制串都会被误判
- **修复**：改用结构化事件（如专门的 `itinerary_created` 事件携带 ID）

#### P1-14. AgentActivationBanner 仅配置 travel
- **位置**：[AgentActivationBanner.tsx:5-9](file:///c:/Users/29105/Desktop/claw7/frontend/src/components/AgentActivationBanner.tsx#L5-L9)
- **问题**：`AGENT_INFO` 只有 `travel` 一项，其它智能体通过 `route` 事件激活后 banner 返回 null，用户无视觉反馈
- **修复**：从后端动态获取智能体图标和欢迎语，或在前端配置所有内置智能体

#### P1-15. FallbackLLM 完全未接入
- **位置**：[fallback.py](file:///c:/Users/29105/Desktop/claw7/infrastructure/llm/fallback.py)
- **问题**：定义了完整的多 provider 降级链，但 app.py 直接 `OpenAILLM(...)` 单实例，没有任何地方实例化 FallbackLLM
- **修复**：在 app.py 用 FallbackLLM 包装多个 provider

#### P1-16. 私有成员直接外部访问（封装破坏）
- **位置**：
  - [dynamic_agent.py:65](file:///c:/Users/29105/Desktop/claw7/domain/agent/dynamic_agent.py#L65)：`policy=tool_executor._policy`
  - [dynamic_agent.py:113](file:///c:/Users/29105/Desktop/claw7/domain/agent/dynamic_agent.py#L113)：`mcp_runtime._catalog.list_tool_refs()`
  - [engine.py:208/218](file:///c:/Users/29105/Desktop/claw7/domain/reasoning/engine.py#L208)：`self._tool_registry._tools`
  - [engine.py:266](file:///c:/Users/29105/Desktop/claw7/domain/reasoning/engine.py#L266)：`self._tool_executor._handlers`
- **修复**：在被依赖类上暴露公共 API

---

### P2 低问题（细节优化，可延后）

#### P2-1. UserStore / ProfileManager 缓存永不刷新
- **位置**：[auth.py:45-47](file:///c:/Users/29105/Desktop/claw7/domain/user/auth/auth.py#L45-L47)、[profile/manager.py:14-20](file:///c:/Users/29105/Desktop/claw7/domain/user/profile/manager.py#L14-L20)
- **问题**：`if self._cache: return` 首次加载后永不失效，多进程下新增用户/改密码不可见
- **修复**：加 TTL 或主动失效

#### P2-2. PBKDF2 迭代次数偏低
- **位置**：[auth.py:28](file:///c:/Users/29105/Desktop/claw7/domain/user/auth/auth.py#L28)
- **问题**：100000 轮在现代硬件下偏低（OWASP 建议 600000+ for PBKDF2-SHA256）
- **修复**：提高到 600000

#### P2-3. AuditLogger 无自动清理
- **位置**：[audit/logger.py:354-362](file:///c:/Users/29105/Desktop/claw7/domain/shared/audit/logger.py#L354-L362)
- **问题**：JSONL 文件按日轮转但无清理/压缩，长期运行无限增长；磁盘满则审计丢失
- **修复**：加保留天数配置 + 自动删除旧文件

#### P2-4. MetricsCollector.active_sessions 是 dead metric
- **位置**：[collector.py:37-40](file:///c:/Users/29105/Desktop/claw7/domain/shared/metrics/collector.py#L37-L40)
- **问题**：Gauge 定义后从未 inc/dec，永远为 0
- **修复**：在 SessionManager 创建/销毁 session 时调用，或删除该指标

#### P2-5. TraceStore 纯内存且只存最新一条
- **位置**：[runtime/trace.py:42-46](file:///c:/Users/29105/Desktop/claw7/domain/shared/runtime/trace.py#L42-L46)
- **问题**：`_latest_by_session` dict 每次覆盖，重启全丢，无法做历史 trace 回放
- **修复**：持久化到 DB，或至少保留 N 条

#### P2-6. sanitizer 正则过于粗糙
- **位置**：[audit/sanitizer.py:7-12](file:///c:/Users/29105/Desktop/claw7/domain/shared/audit/sanitizer.py#L7-L12)
- **问题**：`\b\d{16,19}\b` 会误伤 16-19 位订单号/时间戳；不处理护照/地址/IP；只做 audit 脱敏，未对入库的 session_turns.content / memories.text 脱敏
- **修复**：细化正则，或用命名实体识别

#### P2-7. AgentFactory._agent_cache 不含 user_id
- **位置**：[orchestrator.py:119](file:///c:/Users/29105/Desktop/claw7/domain/agent/orchestrator.py#L119)
- **问题**：仅以 `agent_id` 为 key，同一 agent_id 不同用户共享实例。对 custom agent（含 user_id 隔离语义）可能导致跨用户状态污染
- **修复**：缓存 key 改为 `(agent_id, user_id)`

#### P2-8. 云合主循环缺独立迭代上限
- **位置**：[orchestrator.py:292](file:///c:/Users/29105/Desktop/claw7/domain/agent/orchestrator.py#L292)
- **问题**：`while delegation_count < MAX_DELEGATIONS` 仅在 `delegate_to` 成功时计数。若 LLM 反复调用 `list_available_agents` 或无效 `delegate_to`，循环无独立上限，可能长时间空转
- **修复**：加 `max_yunhe_iterations` 计数器

#### P2-9. TravelAgent 的 itinerary_id 提取依赖正则
- **位置**：[domain/travel/agent.py:58-65](file:///c:/Users/29105/Desktop/claw7/domain/travel/agent.py#L58-L65)
- **问题**：兜底用 `re.search(r'([a-f0-9]{16})', reply)`，注释自承"不应依赖正则匹配自由文本（脆弱、易误匹配）"
- **修复**：同 P1-13，改用结构化事件

#### P2-10. TravelIntentClassifier 关键词分类阈值可能误判
- **位置**：[travel_classifier.py:172-174](file:///c:/Users/29105/Desktop/claw7/domain/travel/intent/travel_classifier.py#L172-L174)
- **问题**：单关键词匹配 confidence=0.75 直接跳过 LLM。"改签的话需要多少钱"（同时匹配"改签"和"多少钱"）会被判为 ITINERARY_ADJUST 而非 BUDGET_CALC
- **修复**：调高阈值或引入冲突解决机制

#### P2-11. policy 频率限制基于内存
- **位置**：[policy.py:36](file:///c:/Users/29105/Desktop/claw7/infrastructure/tools/policy.py#L36)
- **问题**：`_call_log` 是实例内存字典，多实例失效
- **修复**：用 Redis

#### P2-12. MemoryDistiller._compress_content 用废弃 API
- **位置**：[memory_distiller.py:206-208](file:///c:/Users/29105/Desktop/claw7/domain/memory/memory_distiller.py#L206-L208)
- **问题**：`asyncio.get_event_loop()` 在 Python 3.12+ 无运行 loop 时会报 DeprecationWarning；且 `if loop.is_running(): return content[:30]` 意味着在异步上下文里 LLM 压缩永远不执行
- **修复**：用 `asyncio.run()` 或改为同步调用

#### P2-13. ToolCatalog 与 ToolRegistry 职责重叠
- **位置**：[catalog.py](file:///c:/Users/29105/Desktop/claw7/infrastructure/tools/catalog.py)
- **问题**：`ToolCatalog`（仅存 spec）与 `ToolRegistry`（spec+handler）重叠，且 ToolCatalog 在探索中未见被实际使用
- **修复**：删除 ToolCatalog，或明确职责边界

#### P2-14. health 检查与实际存储脱节
- **位置**：[health.py:16-31](file:///c:/Users/29105/Desktop/claw7/infrastructure/persistence/health.py#L16-L31)
- **问题**：只 ping Redis，但 session_backend="file"、主存储是 SQLite。Redis 未启用时 health 永远 degraded，但实际系统正常
- **修复**：按 session_backend 动态选检查项，加 SQLite 检查

#### P2-15. 死代码清理
- **位置**：
  - [MemoryPanel.tsx](file:///c:/Users/29105/Desktop/claw7/frontend/src/components/MemoryPanel.tsx)：与 MemoryPage 重复
  - [Empty.tsx](file:///c:/Users/29105/Desktop/claw7/frontend/src/components/Empty.tsx)：使用不存在的 `@/lib/utils` 别名
  - [useTheme.ts](file:///c:/Users/29105/Desktop/claw7/frontend/src/hooks/useTheme.ts)：从未被调用
  - [api/middleware/](file:///c:/Users/29105/Desktop/claw7/api/middleware)：整个目录死代码
- **修复**：直接删除

#### P2-16. 多个 API 函数定义后未使用
- **位置**：[api.ts](file:///c:/Users/29105/Desktop/claw7/frontend/src/utils/api.ts)：`fetchSkillDetail`、`fetchMCPServer`、`listShareLinks`、`deleteShareLink`、`updateItinerary`
- **问题**：分享管理 UI 缺失（只能创建不能列出/撤销）
- **修复**：补全 UI 或删除未用函数

#### P2-17. Login 标题与产品定位不符
- **位置**：[Login.tsx:55](file:///c:/Users/29105/Desktop/claw7/frontend/src/pages/Login.tsx#L55)
- **问题**：仍为 "云合 旅行规划师"，但项目已是通用智能体框架定位
- **修复**：改为 "云合" 或 "Claw7"

#### P2-18. 启动时序耦合
- **位置**：[server.py:66](file:///c:/Users/29105/Desktop/claw7/api/server.py#L66)
- **问题**：`_container = build_orchestrator()` 在模块加载时同步执行，包含 init_db、建 MCP runtime 等，若 DB 文件锁或 MCP 元数据异常，import api.server 即失败
- **修复**：改为 lifespan 内懒加载

#### P2-19. ~~CLI 与 Web 入口能力割裂~~ ✅ 已解决（2026-07-04）
- `application/cli/` 目录和 `app.py` 中的 `build_agent()` 函数已删除，统一走 `build_orchestrator()` 入口。

#### P2-20. 设计文档版本与代码状态错位
- **位置**：[UNIVERSAL_AGENT_DESIGN.md](file:///c:/Users/29105/Desktop/claw7/docs/UNIVERSAL_AGENT_DESIGN.md)
- **问题**：标注"设计提案，2026-07-01"，但 Phase 1-3 任务已在代码中实现，Phase 4 的 CostGuard 接入却未实现。文档未标注"已实施/待实施"状态
- **修复**：在每个 Phase 任务后标注当前实现状态

---

## 四、建议的修复优先级路线

### 第一阶段：修复阻塞性问题（让核心功能跑起来）

1. **P0-1** amap/fliggy 脚本路径
2. **P0-2** amap-maps skill 目录结构
3. **P0-3** prompt_guard.py 语法错误
4. **P0-5** OpenAILLM 并发安全
5. **P0-6** Token query 参数泄露
6. **P1-11** need_input SSE 事件前端

### 第二阶段：消除架构债务（让系统可维护）

7. **P0-4** tasks 表职责越界（加 sessions.user_id 列）
8. **P1-1** 删除空 travel_core.py + 更新文档
9. **P1-8** 删除 middleware 死代码
10. **P1-10** API 层直连 DB 改走 Repository
11. **P1-15** 接入 FallbackLLM
12. **P1-16** 私有成员访问改公共 API

### 第三阶段：补齐设计承诺（让功能完整）

13. **P1-2** 接入 CostGuard / ToolSelector
14. **P1-3** 接入 MemoryExtractor / MemoryDistiller
15. **P1-4** 统一记忆体系
16. **P1-7** 统一 prompt/上下文体系
17. **P1-12** 统一三栏布局
18. **P1-13/P2-9** 行程 ID 改结构化事件

### 第四阶段：细节优化

19. 其余 P2 项按需处理

---

> **说明**：本文档基于 2026-07-04 的代码状态梳理。代码持续演进，建议每次大改后回访本文档更新状态。如需深入了解某模块，可直接阅读对应文件的源码（文档中所有引用均带绝对路径和行号）。

# Claw — 通用智能体平台

通用 Agent 调度 + 领域 Agent + Skill + MCP 的智能旅行规划助手。

## 功能概览

| 功能 | 说明 |
|------|------|
| 🤖 多智能体架构 | Orchestrator 总调度 + 旅行 Agent / 云合通用 Agent + 自定义 Agent，支持动态路由 |
| 💬 AI 对话 | 基于大语言模型的流式对话，自动识别旅行意图，多轮交互规划行程 |
| 🗺️ 行程生成 | 根据用户需求自动生成多日行程，含景点、时间、费用、贴士 |
| 📍 地图展示 | Leaflet + 高德瓦片地图，标记行程地点并绘制路线 |
| 💰 花费统计 | 按天/按活动统计预算与实际花费，支持打卡记录 |
| 🔗 行程分享 | 生成分享链接，无需登录即可查看行程 |
| 📊 行程对比 | 最多 4 个行程横向对比预算与活动 |
| 🖼️ 相册管理 | 上传旅行照片，自动提取 EXIF 地理位置，AI 生成游记 |
| 🧠 记忆系统 | 双层记忆（短期/长期），自动提取用户偏好，支持记忆蒸馏 |
| 🔧 Skill + MCP | 模块化技能（高德地图、飞猪旅行）与 MCP 工具代理（Web 搜索） |
| 😊 情感检测 | 实时检测用户情绪，自动调整回复策略 |
| 👤 用户画像 | 根据交互记录自动构建用户偏好标签 |
| 📝 审计日志 | 全链路审计事件记录（LLM 调用、工具执行、意图识别） |
| 🔥 热门推荐 | 实时抓取旅行热门话题与目的地推荐 |
| 👥 用户系统 | 注册/登录、Token 鉴权、自定义智能体管理 |

## 技术栈

**后端**
- Python 3.11+
- FastAPI + Uvicorn
- SQLite（主数据存储）+ Redis（缓存/会话，可选）
- OpenAI 兼容 API（通义千问 / 任意兼容模型）
- 高德地图 Web服务 API（地理编码）
- Prometheus（监控）
- DD

**前端**
- React 18 + TypeScript
- Vite 6
- Tailwind CSS 3
- Zustand（状态管理）
- Leaflet（地图渲染）
- Framer Motion（动画）
- React Router 7

## 项目结构

```
claw7/
├── api/                    # API 路由与中间件（47 个接口）
│   ├── server.py           # FastAPI 主入口
│   ├── routes/             # 路由模块
│   ├── middleware/         # 认证 / 限流中间件
│   └── intl_coords.py      # 国际目的地坐标库
├── domain/                 # 领域层（DDD 核心）
│   ├── agent/              # 多智能体系统（Orchestrator / TravelAgent / DynamicAgent）
│   ├── travel/             # 旅行聚合（意图识别 / 行程 / 相册 / 工具）
│   ├── memory/             # 双层记忆（提取 / 蒸馏）
│   ├── reasoning/          # ReAct 推理引擎（Prompt / 上下文管理）
│   ├── user/               # 用户聚合（认证 / 画像 / 情感 / 会话）
│   └── shared/             # 共享组件（审计 / 监控 / 运行时）
├── infrastructure/         # 基础设施层
│   ├── tools/              # 工具系统（注册表 / 执行器 / 策略 / 适配器）
│   ├── skills/             # Skill 定义（高德地图 / 飞猪 / 自定义）
│   ├── llm/                # LLM 适配器（OpenAI 兼容客户端）
│   ├── persistence/        # 持久化（SQLite 数据库 / 健康检查）
│   ├── mcp/                # MCP 工具代理（运行时 / 目录 / 服务器配置）
│   └── external/           # 外部服务集成
├── application/            # 应用层
│   └── builtin_agents/     # 内置智能体 YAML 配置（travel / yunhe）
├── config/                 # 配置层
│   ├── settings.py          # Pydantic Settings 集中管理
│   └── .env.example         # 环境变量模板
├── frontend/               # React 前端项目
│   ├── src/pages/          # 页面（Home / ItineraryOverview / Memory / Compare / Album / Shared）
│   ├── src/components/     # 通用组件（Chat / Album / Itinerary）
│   ├── src/hooks/          # Zustand 状态管理
│   └── src/utils/          # 工具函数
├── tests/                  # 测试（16 个文件）
├── docs/                   # 文档
├── data/                   # 运行时数据（自动生成）
├── app.py                  # Agent 构建（依赖注入容器）
└── requirements.txt        # Python 依赖
```

## 快速开始

### 1. 环境准备

```bash
# 克隆项目
git clone git@github.com:youshuaiyouqiang/travel-plan-agent.git
cd claw7

# 创建虚拟环境
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

# 安装依赖
pip install -r requirements.txt
```

### 2. 配置环境变量

```bash
cp config/.env.example .env
# 编辑 .env，填入你的 API Key
```

**必填配置**：
- `CLAW_API_KEY` — LLM API 密钥（通义千问或 OpenAI 兼容）
- `AMAP_WEBSERVICE_KEY` — 高德地图 Web服务 Key

### 3. 启动后端

```bash
uvicorn api.server:app --reload --host 0.0.0.0 --port 8000
```

### 4. 启动前端

```bash
cd frontend
npm install
npm run dev
```

前端默认运行在 `http://localhost:5173`，自动代理 `/api` 请求到后端 `localhost:8000`。

## 环境变量说明

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `CLAW_API_KEY` | ✅ | — | LLM API 密钥 |
| `CLAW_MODEL` | ❌ | `qwen3.5-122b-a10b` | 模型名称 |
| `CLAW_BASE_URL` | ❌ | 通义千问 DashScope | OpenAI 兼容 API 地址 |
| `AMAP_WEBSERVICE_KEY` | ✅ | — | 高德地图 Web服务 Key（后端地理编码） |
| `FLYAI_API_KEY` | ❌ | — | 飞猪旅行 API Key |
| `CLAW_LOG_LEVEL` | ❌ | `DEBUG` | 日志级别 |
| `CLAW_DATABASE_PATH` | ❌ | `data/claw.db` | SQLite 数据库路径 |
| `CLAW_RATE_LIMIT_RPM` | ❌ | `60` | 每分钟请求限制 |
| `CLAW_METRICS_ENABLED` | ❌ | `true` | 是否启用 Prometheus 监控 |
| `CLAW_REDIS_URL` | ❌ | `redis://localhost:6379/0` | Redis 连接地址 |
| `CLAW_EMOTION_ENABLED` | ❌ | `true` | 是否启用情感检测 |
| `CLAW_AUDIT_ENABLED` | ❌ | `true` | 是否启用审计日志 |

完整配置项参见 [config/.env.example](config/.env.example)。

## 文档

- [项目 README](../README.md)
- [API 接口文档](api/API.md)
- [DDD 架构说明](architecture.md)
- [多智能体开发指南](MULTI_AGENT_DEV.md)

## 测试

```bash
pytest tests/ -v
```

## License

Private
